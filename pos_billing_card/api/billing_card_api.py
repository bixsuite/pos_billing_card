"""
Billing Card API for multi-floor clothing retail POS workflow.

Flow:
  Floor staff  → scan card → assign customer → add items → save to card → print slip
  Next floor   → scan card → loads existing items → add more → save to card
  Cash counter → scan card → loads all items into POSAwesome → process payment → release card
"""

import json

import frappe
from frappe.utils import flt, now_datetime


# ---------------------------------------------------------------------------
# Core card operations
# ---------------------------------------------------------------------------


@frappe.whitelist()
def scan_card(card_number):
	"""
	Scan a billing card.
	Returns card status, customer info, and a summary of current invoice items.
	"""
	card = frappe.db.get_value(
		"Billing Card",
		{"card_number": card_number},
		["name", "card_number", "status", "customer", "current_invoice", "current_floor", "pos_profile"],
		as_dict=True,
	)

	if not card:
		frappe.throw(f"Billing Card '{card_number}' not found. Please check the card number.")

	result = frappe._dict(card)
	result.items = []
	result.grand_total = 0
	result.total_qty = 0
	result.customer_name = None

	if card.current_invoice:
		try:
			invoice = frappe.get_doc("POS Invoice", card.current_invoice)
			result.customer_name = invoice.customer_name
			result.grand_total = invoice.grand_total
			result.total_qty = invoice.total_qty
			result.items = [
				{
					"item_code": row.item_code,
					"item_name": row.item_name,
					"qty": row.qty,
					"rate": row.rate,
					"amount": row.amount,
					"uom": row.uom,
					"warehouse": row.warehouse,
					"discount_percentage": row.discount_percentage or 0,
					"discount_amount": row.discount_amount or 0,
					"posa_row_id": row.get("posa_row_id") or "",
					"description": row.description or "",
				}
				for row in invoice.items
			]
		except frappe.DoesNotExistError:
			# Invoice was deleted; reset card
			card_doc = frappe.get_doc("Billing Card", card.name)
			card_doc.status = "Available"
			card_doc.save(ignore_permissions=True)
			result.status = "Available"
			result.current_invoice = None

	return result


@frappe.whitelist()
def assign_card(card_number, customer, pos_profile, floor=""):
	"""
	Assign a billing card to a customer and create a new draft POS Invoice.
	Called at the first floor when a customer picks up a card.
	"""
	card = frappe.get_doc("Billing Card", {"card_number": card_number})

	if card.status == "In Use":
		frappe.throw(
			f"Card '{card_number}' is already in use by customer <b>{card.customer}</b>. "
			f"Please release the card first or use a different card."
		)
	if card.status == "Disabled":
		frappe.throw(f"Card '{card_number}' is disabled and cannot be assigned.")

	pos_profile_doc = frappe.get_doc("POS Profile", pos_profile)

	invoice = frappe.new_doc("POS Invoice")
	invoice.customer = customer
	invoice.pos_profile = pos_profile
	invoice.company = pos_profile_doc.company
	invoice.currency = pos_profile_doc.currency or frappe.defaults.get_global_default("currency")
	invoice.bc_billing_card = card.name
	invoice.bc_floor = floor or "Floor 1"
	invoice.set_missing_values()
	invoice.insert(ignore_permissions=True)

	card.status = "In Use"
	card.customer = customer
	card.current_invoice = invoice.name
	card.current_floor = floor or "Floor 1"
	card.pos_profile = pos_profile
	card.assigned_at = now_datetime()
	card.assigned_by = frappe.session.user
	card.save(ignore_permissions=True)

	return {
		"status": "success",
		"invoice": invoice.name,
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name"),
		"card": card.name,
	}


@frappe.whitelist()
def save_floor_items(card_number, items_json, floor="", customer=None):
	"""
	Save the current items from a POSAwesome session to the billing card's draft invoice.
	Called when floor staff click "Save to Card".
	Replaces existing items on the invoice with the ones passed.
	"""
	items = json.loads(items_json) if isinstance(items_json, str) else items_json

	card = frappe.get_doc("Billing Card", {"card_number": card_number})

	if card.status != "In Use":
		frappe.throw(f"Card '{card_number}' is not currently in use. Please assign it to a customer first.")
	if not card.current_invoice:
		frappe.throw(f"No draft invoice found for card '{card_number}'.")

	invoice = frappe.get_doc("POS Invoice", card.current_invoice)

	if invoice.docstatus != 0:
		frappe.throw("This invoice has already been submitted and cannot be modified.")

	if customer and invoice.customer != customer:
		invoice.customer = customer

	# Rebuild items list
	invoice.items = []
	for item in items:
		row = {
			"item_code": item.get("item_code"),
			"item_name": item.get("item_name"),
			"qty": flt(item.get("qty", 1)),
			"rate": flt(item.get("rate", 0)),
			"uom": item.get("uom"),
			"warehouse": item.get("warehouse"),
			"description": item.get("description") or "",
			"discount_percentage": flt(item.get("discount_percentage", 0)),
			"discount_amount": flt(item.get("discount_amount", 0)),
		}
		# Preserve POSAwesome row ID for proper item tracking
		posa_row_id = item.get("posa_row_id") or item.get("rowid") or ""
		if posa_row_id:
			row["posa_row_id"] = posa_row_id
		row = {k: v for k, v in row.items() if v is not None and v != ""}
		invoice.append("items", row)

	invoice.bc_floor = floor
	invoice.set_missing_values()
	invoice.calculate_taxes_and_totals()
	invoice.save(ignore_permissions=True)

	card.current_floor = floor
	card.save(ignore_permissions=True)

	return {
		"status": "success",
		"invoice": invoice.name,
		"grand_total": invoice.grand_total,
		"total_qty": invoice.total_qty,
		"items_count": len(invoice.items),
	}


@frappe.whitelist()
def get_invoice_details(card_number):
	"""
	Return full invoice details for loading into POSAwesome at any floor or cash counter.
	"""
	card = frappe.db.get_value(
		"Billing Card",
		{"card_number": card_number},
		["name", "status", "customer", "current_invoice", "current_floor", "pos_profile"],
		as_dict=True,
	)

	if not card:
		frappe.throw(f"Card '{card_number}' not found.")
	if not card.current_invoice:
		return {"card": card, "invoice": None, "items": []}

	invoice = frappe.get_doc("POS Invoice", card.current_invoice)

	invoice_data = {
		"name": invoice.name,
		"customer": invoice.customer,
		"customer_name": invoice.customer_name,
		"pos_profile": invoice.pos_profile,
		"company": invoice.company,
		"currency": invoice.currency,
		"grand_total": invoice.grand_total,
		"total_qty": invoice.total_qty,
		"net_total": invoice.net_total,
		"total_taxes_and_charges": invoice.total_taxes_and_charges,
		"taxes": [
			{
				"charge_type": t.charge_type,
				"account_head": t.account_head,
				"description": t.description,
				"rate": t.rate,
				"tax_amount": t.tax_amount,
				"total": t.total,
			}
			for t in invoice.taxes
		],
		"items": [
			{
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": row.qty,
				"rate": row.rate,
				"amount": row.amount,
				"uom": row.uom,
				"warehouse": row.warehouse,
				"discount_percentage": row.discount_percentage or 0,
				"discount_amount": row.discount_amount or 0,
				"posa_row_id": row.get("posa_row_id") or "",
				"description": row.description or "",
			}
			for row in invoice.items
		],
	}

	return {"card": card, "invoice": invoice_data, "items": invoice_data["items"]}


@frappe.whitelist()
def release_card(card_number):
	"""
	Release a billing card — mark it Available so it can be reused.
	Called after payment is completed.
	"""
	card = frappe.get_doc("Billing Card", {"card_number": card_number})
	card.status = "Available"
	card.customer = None
	card.current_invoice = None
	card.current_floor = None
	card.save(ignore_permissions=True)

	return {"status": "success", "message": f"Card '{card_number}' is now available."}


# ---------------------------------------------------------------------------
# Utility operations
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_available_cards():
	"""Return summary of available and in-use cards for the card management panel."""
	available = frappe.get_list(
		"Billing Card",
		filters={"status": "Available"},
		fields=["card_number", "name"],
		order_by="card_number asc",
	)
	in_use = frappe.get_list(
		"Billing Card",
		filters={"status": "In Use"},
		fields=["card_number", "name", "customer", "current_floor"],
		order_by="card_number asc",
	)
	return {"available": available, "in_use": in_use}


@frappe.whitelist()
def bulk_create_cards(count, prefix="CARD-"):
	"""
	Bulk create billing cards.
	Example: bulk_create_cards(50, "BC-") → BC-001 … BC-050
	"""
	count = int(count)
	if count < 1 or count > 500:
		frappe.throw("Count must be between 1 and 500.")

	created = []
	skipped = []
	pad = len(str(count))

	for i in range(1, count + 1):
		card_number = f"{prefix}{str(i).zfill(pad)}"
		if frappe.db.exists("Billing Card", {"card_number": card_number}):
			skipped.append(card_number)
			continue
		card = frappe.new_doc("Billing Card")
		card.card_number = card_number
		card.status = "Available"
		card.insert(ignore_permissions=True)
		created.append(card_number)

	frappe.db.commit()
	return {"created": len(created), "skipped": len(skipped), "cards": created}


# ---------------------------------------------------------------------------
# Document event hook — auto-release card when POS Invoice is submitted
# (handles payment done via normal POSAwesome flow without using our Release button)
# ---------------------------------------------------------------------------


def on_pos_invoice_submit(doc, method=None):
	"""Auto-release the billing card when a linked POS Invoice is submitted."""
	card_id = doc.get("bc_billing_card")
	if not card_id:
		return

	try:
		card = frappe.get_doc("Billing Card", card_id)
		if card.status == "In Use" and card.current_invoice == doc.name:
			card.status = "Available"
			card.customer = None
			card.current_invoice = None
			card.current_floor = None
			card.save(ignore_permissions=True)
	except Exception:
		pass  # Do not block invoice submission on card errors
