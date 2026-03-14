import frappe


def after_install():
	# Ensure the Billing Card doctype table exists before applying fixtures
	# (fixtures contain Custom Fields that link to Billing Card)
	frappe.reload_doc("Pos Billing Card", "doctype", "billing_card")

	from frappe.utils.fixtures import sync_fixtures
	sync_fixtures("pos_billing_card")
