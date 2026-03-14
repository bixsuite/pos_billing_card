/**
 * POS Billing Card Extension for POSAwesome
 *
 * Injects a floating "Billing Card" button into the POSAwesome screen.
 * Handles the full multi-floor retail workflow:
 *   Floor staff  → scan card → customer loads → add items → Save to Card → print slip
 *   Next floors  → scan card → existing items load into POS → add more → Save to Card
 *   Cash counter → scan card → all items load into POS → pay normally → Release Card
 *
 * Injected via hooks.py: page_js = { "posapp": "public/js/pos_billing_card_extension.js" }
 */

(function () {
	"use strict";

	const BC_API = "pos_billing_card.api.billing_card_api";
	const FAB_ID = "bc-fab-btn";
	const PANEL_ID = "bc-slide-panel";

	// -------------------------------------------------------------------------
	// POSAwesome Pinia store access
	// -------------------------------------------------------------------------

	function getPosaStores() {
		try {
			const el = document.querySelector(".main-section");
			if (!el || !el.__vue_app__) return null;
			const pinia = el.__vue_app__.config.globalProperties.$pinia;
			if (!pinia || !pinia._s) return null;
			return {
				invoice: pinia._s.get("invoice"),
				customers: pinia._s.get("customers"),
				ui: pinia._s.get("ui"),
				items: pinia._s.get("items"),
			};
		} catch (e) {
			console.warn("[BillingCard] Could not access POSAwesome stores:", e);
			return null;
		}
	}

	/** Returns current items from POSAwesome's invoice store as a plain array. */
	function getCurrentPosaItems() {
		const stores = getPosaStores();
		if (!stores?.invoice?.items) return [];
		const result = [];
		stores.invoice.items.forEach((item) => result.push(item));
		return result;
	}

	/** Returns current customer code from POSAwesome's invoice store. */
	function getCurrentPosaCustomer() {
		const stores = getPosaStores();
		return stores?.invoice?.invoiceDoc?.customer || null;
	}

	/** Returns the active POS Profile name from POSAwesome. */
	function getCurrentPosProfile() {
		// POSAwesome stores POS profile on the page app instance
		try {
			const page = frappe.get_route_info()?.page || cur_page;
			if (page?.$PosApp?.pos_profile) return page.$PosApp.pos_profile;
		} catch (_) {}
		// Fallback: read from invoice store
		const stores = getPosaStores();
		return stores?.invoice?.invoiceDoc?.pos_profile || null;
	}

	/**
	 * Load an invoice's customer + items into POSAwesome's live session.
	 * Uses invoiceStore.setItems() and mergeInvoiceDoc() from Pinia.
	 */
	function loadIntoPos(invoiceData) {
		const stores = getPosaStores();
		if (!stores?.invoice) {
			frappe.show_alert({ message: "Could not connect to POSAwesome session.", indicator: "red" });
			return false;
		}

		// Set customer
		if (invoiceData.customer) {
			stores.invoice.mergeInvoiceDoc({ customer: invoiceData.customer });
		}

		// Set items (replace all)
		if (invoiceData.items?.length) {
			stores.invoice.setItems(invoiceData.items);
			if (typeof stores.invoice.recalculateTotals === "function") {
				stores.invoice.recalculateTotals();
			}
		}

		return true;
	}

	// -------------------------------------------------------------------------
	// API helpers
	// -------------------------------------------------------------------------

	function apiCall(method, args, callback, errorCallback) {
		frappe.call({
			method: `${BC_API}.${method}`,
			args,
			callback: (r) => callback(r.message),
			error: errorCallback || ((e) => frappe.show_alert({ message: e.message || "Error", indicator: "red" })),
		});
	}

	// -------------------------------------------------------------------------
	// Styles (injected once)
	// -------------------------------------------------------------------------

	function injectStyles() {
		if (document.getElementById("bc-extension-styles")) return;
		const style = document.createElement("style");
		style.id = "bc-extension-styles";
		style.textContent = `
			/* FAB Button */
			#${FAB_ID} {
				position: fixed;
				bottom: 80px;
				right: 24px;
				z-index: 9998;
				background: #1565c0;
				color: #fff;
				border: none;
				border-radius: 28px;
				padding: 12px 20px;
				font-size: 13px;
				font-weight: 600;
				cursor: pointer;
				box-shadow: 0 4px 12px rgba(21,101,192,0.45);
				display: flex;
				align-items: center;
				gap: 8px;
				transition: background 0.2s, transform 0.15s;
				user-select: none;
			}
			#${FAB_ID}:hover  { background: #1976d2; transform: translateY(-2px); }
			#${FAB_ID}:active { transform: translateY(0); }
			#${FAB_ID} .bc-icon { font-size: 16px; }

			/* Slide-in panel */
			#${PANEL_ID} {
				position: fixed;
				top: 0; right: -420px;
				width: 420px;
				height: 100vh;
				background: #fff;
				box-shadow: -4px 0 24px rgba(0,0,0,0.18);
				z-index: 9999;
				display: flex;
				flex-direction: column;
				transition: right 0.3s ease;
				font-family: inherit;
			}
			#${PANEL_ID}.bc-open { right: 0; }

			.bc-panel-header {
				background: #1565c0;
				color: #fff;
				padding: 16px 20px;
				display: flex;
				align-items: center;
				justify-content: space-between;
				flex-shrink: 0;
			}
			.bc-panel-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
			.bc-close-btn {
				background: none; border: none; color: #fff;
				font-size: 20px; cursor: pointer; padding: 0 4px;
				line-height: 1;
			}

			.bc-panel-body { flex: 1; overflow-y: auto; padding: 16px 20px; }

			/* Card scan section */
			.bc-scan-row {
				display: flex; gap: 8px; align-items: center; margin-bottom: 16px;
			}
			.bc-scan-input {
				flex: 1; padding: 10px 14px; border: 2px solid #1565c0;
				border-radius: 8px; font-size: 15px; outline: none;
			}
			.bc-scan-input:focus { border-color: #1976d2; box-shadow: 0 0 0 3px rgba(25,118,210,0.15); }
			.bc-scan-btn {
				padding: 10px 18px; background: #1565c0; color: #fff;
				border: none; border-radius: 8px; font-size: 14px;
				font-weight: 600; cursor: pointer;
			}
			.bc-scan-btn:hover { background: #1976d2; }

			/* Card info badge */
			.bc-card-info {
				background: #e3f2fd; border-radius: 10px;
				padding: 14px 16px; margin-bottom: 14px;
			}
			.bc-card-info .bc-badge {
				display: inline-block; padding: 3px 10px;
				border-radius: 12px; font-size: 11px; font-weight: 700;
				text-transform: uppercase; margin-bottom: 6px;
			}
			.bc-badge-available { background: #c8e6c9; color: #1b5e20; }
			.bc-badge-inuse     { background: #bbdefb; color: #0d47a1; }
			.bc-badge-disabled  { background: #eeeeee; color: #616161; }
			.bc-info-row { font-size: 13px; color: #37474f; margin: 4px 0; }
			.bc-info-row strong { color: #1a237e; }

			/* Items table */
			.bc-items-section h4 { font-size: 13px; font-weight: 600; color: #546e7a; margin: 0 0 8px; }
			.bc-items-table {
				width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 12px;
			}
			.bc-items-table th {
				background: #f5f5f5; padding: 7px 8px; text-align: left;
				font-weight: 600; color: #37474f; border-bottom: 1px solid #e0e0e0;
			}
			.bc-items-table td {
				padding: 7px 8px; border-bottom: 1px solid #f0f0f0; color: #424242;
				vertical-align: middle;
			}
			.bc-items-table tr:hover td { background: #fafafa; }
			.bc-total-row { text-align: right; font-weight: 700; font-size: 14px; color: #1a237e; margin-bottom: 16px; }

			/* Floor selector */
			.bc-floor-row {
				display: flex; gap: 8px; align-items: center;
				margin-bottom: 14px; flex-wrap: wrap;
			}
			.bc-floor-row label { font-size: 13px; font-weight: 600; color: #546e7a; }
			.bc-floor-select {
				padding: 7px 12px; border: 1px solid #cfd8dc; border-radius: 6px;
				font-size: 13px; flex: 1; min-width: 120px;
			}

			/* Action buttons */
			.bc-actions {
				display: flex; flex-direction: column; gap: 8px; margin-top: 8px;
			}
			.bc-btn {
				padding: 11px 16px; border: none; border-radius: 8px;
				font-size: 13.5px; font-weight: 600; cursor: pointer;
				width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
				transition: filter 0.15s;
			}
			.bc-btn:hover { filter: brightness(1.08); }
			.bc-btn-primary   { background: #1565c0; color: #fff; }
			.bc-btn-success   { background: #2e7d32; color: #fff; }
			.bc-btn-warning   { background: #e65100; color: #fff; }
			.bc-btn-info      { background: #00695c; color: #fff; }
			.bc-btn-secondary { background: #546e7a; color: #fff; }
			.bc-btn-danger    { background: #b71c1c; color: #fff; }
			.bc-btn-outline   { background: #fff; color: #1565c0; border: 2px solid #1565c0; }
			.bc-btn:disabled  { opacity: 0.5; cursor: not-allowed; filter: none; }

			/* Overlay */
			#bc-overlay {
				display: none;
				position: fixed; inset: 0;
				background: rgba(0,0,0,0.3);
				z-index: 9997;
			}
			#bc-overlay.bc-open { display: block; }

			/* Assign form */
			.bc-assign-form { display: flex; flex-direction: column; gap: 10px; }
			.bc-form-group label { display: block; font-size: 12px; font-weight: 600; color: #546e7a; margin-bottom: 4px; }
			.bc-form-group input, .bc-form-group select {
				width: 100%; padding: 9px 12px;
				border: 1px solid #cfd8dc; border-radius: 6px;
				font-size: 13px; box-sizing: border-box;
			}

			/* Divider */
			.bc-divider { border: none; border-top: 1px solid #eceff1; margin: 14px 0; }

			.bc-status-msg { font-size: 12px; color: #78909c; text-align: center; padding: 20px; }
		`;
		document.head.appendChild(style);
	}

	// -------------------------------------------------------------------------
	// Panel state
	// -------------------------------------------------------------------------

	let _panel = null;
	let _overlay = null;
	let _currentCard = null; // last scanned card data

	function createPanel() {
		if (_panel) return;

		_overlay = document.createElement("div");
		_overlay.id = "bc-overlay";
		_overlay.addEventListener("click", closePanel);
		document.body.appendChild(_overlay);

		_panel = document.createElement("div");
		_panel.id = PANEL_ID;
		_panel.innerHTML = buildPanelHTML();
		document.body.appendChild(_panel);

		// Wire up scan input enter key
		_panel.querySelector("#bc-card-input").addEventListener("keydown", (e) => {
			if (e.key === "Enter") doScanCard();
		});
		_panel.querySelector("#bc-scan-btn").addEventListener("click", doScanCard);
	}

	function buildPanelHTML() {
		return `
		<div class="bc-panel-header">
			<h3>&#x1F4B3; Billing Card</h3>
			<button class="bc-close-btn" onclick="window._bcClosePanel()">&#x2715;</button>
		</div>
		<div class="bc-panel-body">
			<!-- Scan row -->
			<div class="bc-scan-row">
				<input id="bc-card-input" class="bc-scan-input" type="text"
					placeholder="Scan or enter card number…" autocomplete="off" />
				<button id="bc-scan-btn" class="bc-scan-btn">Scan</button>
			</div>

			<!-- Dynamic content area -->
			<div id="bc-content">
				<p class="bc-status-msg">Scan a billing card to begin.</p>
			</div>
		</div>`;
	}

	function openPanel() {
		createPanel();
		_panel.classList.add("bc-open");
		_overlay.classList.add("bc-open");
		setTimeout(() => _panel.querySelector("#bc-card-input")?.focus(), 320);
	}

	function closePanel() {
		_panel?.classList.remove("bc-open");
		_overlay?.classList.remove("bc-open");
	}

	// Expose close to inline onclick
	window._bcClosePanel = closePanel;

	// -------------------------------------------------------------------------
	// Scan card action
	// -------------------------------------------------------------------------

	function doScanCard() {
		const input = _panel.querySelector("#bc-card-input");
		const cardNumber = (input?.value || "").trim();
		if (!cardNumber) {
			frappe.show_alert({ message: "Please enter a card number.", indicator: "orange" });
			return;
		}

		document.getElementById("bc-content").innerHTML = '<p class="bc-status-msg">Loading…</p>';

		apiCall("scan_card", { card_number: cardNumber }, (data) => {
			_currentCard = data;
			renderCardContent(data);
		});
	}

	// -------------------------------------------------------------------------
	// Render card content based on status
	// -------------------------------------------------------------------------

	function renderCardContent(card) {
		const content = document.getElementById("bc-content");
		if (!content) return;

		const badgeClass =
			card.status === "Available"
				? "bc-badge-available"
				: card.status === "In Use"
					? "bc-badge-inuse"
					: "bc-badge-disabled";

		let html = `
		<div class="bc-card-info">
			<span class="bc-badge ${badgeClass}">${card.status}</span>
			<div class="bc-info-row"><strong>Card:</strong> ${card.card_number}</div>
			${card.customer ? `<div class="bc-info-row"><strong>Customer:</strong> ${card.customer_name || card.customer}</div>` : ""}
			${card.current_floor ? `<div class="bc-info-row"><strong>Last Floor:</strong> ${card.current_floor}</div>` : ""}
		</div>`;

		if (card.status === "Available") {
			html += renderAssignForm(card.card_number);
		} else if (card.status === "In Use") {
			html += renderFloorSelector();
			html += renderItemsTable(card.items, card.grand_total);
			html += renderInUseActions(card);
		} else {
			html += `<p class="bc-status-msg" style="color:#b71c1c;">This card is disabled. Contact a manager.</p>`;
		}

		content.innerHTML = html;
		wireContentEvents(card);
	}

	function renderAssignForm(cardNumber) {
		return `
		<div class="bc-assign-form">
			<p style="font-size:13px;color:#546e7a;margin:0 0 10px;">
				This card is <b>available</b>. Assign it to a customer to start a new invoice.
			</p>
			<div class="bc-form-group">
				<label>Customer *</label>
				<input id="bc-customer-input" type="text" placeholder="Customer name or ID" />
			</div>
			<div class="bc-form-group">
				<label>Floor</label>
				<select id="bc-floor-assign">
					<option value="Floor 1">Floor 1</option>
					<option value="Floor 2">Floor 2</option>
					<option value="Floor 3">Floor 3</option>
					<option value="Floor 4">Floor 4</option>
					<option value="Cash Counter">Cash Counter</option>
				</select>
			</div>
			<div class="bc-actions">
				<button class="bc-btn bc-btn-primary" id="bc-assign-btn">
					&#x2795; Assign Card to Customer
				</button>
				<button class="bc-btn bc-btn-outline" id="bc-assign-from-pos-btn">
					&#x21E9; Assign &amp; Use Current POS Customer
				</button>
			</div>
		</div>`;
	}

	function renderFloorSelector() {
		return `
		<div class="bc-floor-row">
			<label>Current Floor:</label>
			<select id="bc-floor-select" class="bc-floor-select">
				<option value="Floor 1">Floor 1</option>
				<option value="Floor 2">Floor 2</option>
				<option value="Floor 3">Floor 3</option>
				<option value="Floor 4">Floor 4</option>
				<option value="Cash Counter">Cash Counter</option>
			</select>
		</div>`;
	}

	function renderItemsTable(items, grandTotal) {
		if (!items?.length) {
			return `<p class="bc-status-msg">No items added yet.</p>`;
		}

		const rows = items
			.map(
				(it) => `
			<tr>
				<td>${it.item_name || it.item_code}</td>
				<td style="text-align:center">${it.qty}</td>
				<td style="text-align:right">${frappe.format(it.rate, { fieldtype: "Currency" })}</td>
				<td style="text-align:right">${frappe.format(it.amount, { fieldtype: "Currency" })}</td>
			</tr>`,
			)
			.join("");

		return `
		<div class="bc-items-section">
			<h4>Items on Card (${items.length})</h4>
			<table class="bc-items-table">
				<thead>
					<tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
			<div class="bc-total-row">
				Grand Total: ${frappe.format(grandTotal, { fieldtype: "Currency" })}
			</div>
		</div>
		<hr class="bc-divider" />`;
	}

	function renderInUseActions(card) {
		const hasItems = card.items?.length > 0;
		return `
		<div class="bc-actions">
			<button class="bc-btn bc-btn-primary" id="bc-load-btn" ${hasItems ? "" : "disabled"}>
				&#x21E7; Load Items into POS
			</button>
			<button class="bc-btn bc-btn-success" id="bc-save-btn">
				&#x1F4BE; Save Current POS Items to Card
			</button>
			<button class="bc-btn bc-btn-info" id="bc-print-btn" ${hasItems ? "" : "disabled"}>
				&#x1F5A8; Print Floor Slip
			</button>
			<hr class="bc-divider" style="margin:4px 0" />
			<button class="bc-btn bc-btn-secondary" id="bc-release-btn">
				&#x2714; Release Card (After Payment)
			</button>
		</div>`;
	}

	// -------------------------------------------------------------------------
	// Wire events after rendering
	// -------------------------------------------------------------------------

	function wireContentEvents(card) {
		const content = document.getElementById("bc-content");
		if (!content) return;

		// -- Assign actions --
		const assignBtn = content.querySelector("#bc-assign-btn");
		if (assignBtn) {
			assignBtn.addEventListener("click", () => {
				const customer = content.querySelector("#bc-customer-input")?.value?.trim();
				const floor = content.querySelector("#bc-floor-assign")?.value || "Floor 1";
				if (!customer) {
					frappe.show_alert({ message: "Please enter a customer name.", indicator: "orange" });
					return;
				}
				doAssignCard(card.card_number, customer, floor);
			});
		}

		const assignFromPosBtn = content.querySelector("#bc-assign-from-pos-btn");
		if (assignFromPosBtn) {
			assignFromPosBtn.addEventListener("click", () => {
				const posCustomer = getCurrentPosaCustomer();
				if (!posCustomer) {
					frappe.show_alert({
						message: "No customer selected in POS. Please select a customer in POSAwesome first.",
						indicator: "orange",
					});
					return;
				}
				const floor = content.querySelector("#bc-floor-assign")?.value || "Floor 1";
				doAssignCard(card.card_number, posCustomer, floor);
			});
		}

		// -- In-Use actions --
		content.querySelector("#bc-load-btn")?.addEventListener("click", () => {
			doLoadIntoPos(card);
		});

		content.querySelector("#bc-save-btn")?.addEventListener("click", () => {
			const floor = content.querySelector("#bc-floor-select")?.value || card.current_floor || "Floor 1";
			doSaveFromPos(card.card_number, floor);
		});

		content.querySelector("#bc-print-btn")?.addEventListener("click", () => {
			printFloorSlip(card);
		});

		content.querySelector("#bc-release-btn")?.addEventListener("click", () => {
			doReleaseCard(card.card_number);
		});
	}

	// -------------------------------------------------------------------------
	// Business logic actions
	// -------------------------------------------------------------------------

	function doAssignCard(cardNumber, customer, floor) {
		const posProfile = getCurrentPosProfile();
		if (!posProfile) {
			frappe.show_alert({ message: "No active POS Profile found. Please open a POS session first.", indicator: "red" });
			return;
		}

		frappe.show_alert({ message: "Assigning card…", indicator: "blue" });

		apiCall("assign_card", { card_number: cardNumber, customer, pos_profile: posProfile, floor }, (data) => {
			frappe.show_alert({ message: `Card ${cardNumber} assigned to ${data.customer_name || customer}`, indicator: "green" });

			// Auto-load customer into POSAwesome
			const stores = getPosaStores();
			if (stores?.invoice) {
				stores.invoice.mergeInvoiceDoc({ customer });
			}

			// Refresh panel
			apiCall("scan_card", { card_number: cardNumber }, (refreshed) => {
				_currentCard = refreshed;
				renderCardContent(refreshed);
			});
		});
	}

	function doSaveFromPos(cardNumber, floor) {
		const items = getCurrentPosaItems();
		const customer = getCurrentPosaCustomer();

		if (!items.length) {
			frappe.show_alert({ message: "No items in the current POS session to save.", indicator: "orange" });
			return;
		}

		frappe.show_alert({ message: "Saving to card…", indicator: "blue" });

		apiCall(
			"save_floor_items",
			{
				card_number: cardNumber,
				items_json: JSON.stringify(items),
				floor,
				customer: customer || null,
			},
			(data) => {
				frappe.show_alert({
					message: `Saved ${data.items_count} item(s) to card. Grand Total: ${frappe.format(data.grand_total, { fieldtype: "Currency" })}`,
					indicator: "green",
				});
				// Refresh card data
				apiCall("scan_card", { card_number: cardNumber }, (refreshed) => {
					_currentCard = refreshed;
					renderCardContent(refreshed);
				});
			},
		);
	}

	function doLoadIntoPos(card) {
		apiCall("get_invoice_details", { card_number: card.card_number }, (data) => {
			if (!data.invoice) {
				frappe.show_alert({ message: "No invoice found for this card.", indicator: "orange" });
				return;
			}

			frappe.confirm(
				`Load <b>${data.items.length}</b> item(s) for <b>${data.invoice.customer_name}</b> into POS?<br>
				<small>This will replace any items currently in the POS session.</small>`,
				() => {
					const ok = loadIntoPos(data.invoice);
					if (ok) {
						frappe.show_alert({
							message: `Loaded ${data.items.length} item(s) into POS for ${data.invoice.customer_name}`,
							indicator: "green",
						});
						closePanel();
					}
				},
			);
		});
	}

	function doReleaseCard(cardNumber) {
		frappe.confirm(
			`Release card <b>${cardNumber}</b>?<br>
			<small>The card will be marked Available and can be assigned to the next customer.</small>`,
			() => {
				apiCall("release_card", { card_number: cardNumber }, (data) => {
					frappe.show_alert({ message: data.message, indicator: "green" });
					_currentCard = null;
					document.getElementById("bc-content").innerHTML =
						'<p class="bc-status-msg">Card released. Scan another card.</p>';
					document.getElementById("bc-card-input").value = "";
					document.getElementById("bc-card-input").focus();
				});
			},
		);
	}

	// -------------------------------------------------------------------------
	// Print Floor Slip
	// -------------------------------------------------------------------------

	function printFloorSlip(card) {
		const currency = frappe.boot?.sysdefaults?.currency || "";
		const formatAmt = (v) => `${currency} ${flt(v, 2).toFixed(2)}`;

		const rows = (card.items || [])
			.map(
				(it) =>
					`<tr>
					<td style="padding:6px 8px;border-bottom:1px solid #eee">${it.item_code}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee">${it.item_name}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatAmt(it.rate)}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatAmt(it.amount)}</td>
				</tr>`,
			)
			.join("");

		const now = new Date().toLocaleString();
		const slipHTML = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<title>Floor Slip - Card ${card.card_number}</title>
			<style>
				body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
				h2 { font-size: 16px; margin: 0 0 4px; }
				.header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 12px; }
				.info { margin-bottom: 10px; font-size: 12px; }
				table { width: 100%; border-collapse: collapse; }
				th { background: #f5f5f5; padding: 6px 8px; text-align: left; border-bottom: 2px solid #333; font-size: 11px; }
				.total-row { font-weight: bold; font-size: 13px; margin-top: 10px; text-align: right; border-top: 2px solid #333; padding-top: 8px; }
				.footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; border-top: 1px dashed #ccc; padding-top: 8px; }
			</style>
		</head>
		<body>
			<div class="header">
				<h2>Floor Shopping Slip</h2>
				<div>Card: <strong>${card.card_number}</strong></div>
			</div>
			<div class="info">
				<div><b>Customer:</b> ${card.customer_name || card.customer || "-"}</div>
				<div><b>Floor:</b> ${card.current_floor || "-"}</div>
				<div><b>Date/Time:</b> ${now}</div>
			</div>
			<table>
				<thead>
					<tr>
						<th>Code</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
			<div class="total-row">Grand Total: ${formatAmt(card.grand_total)}</div>
			<div class="footer">Please proceed to the next floor or Cash Counter</div>
		</body>
		</html>`;

		const win = window.open("", "_blank", "width=400,height=600");
		if (!win) {
			frappe.show_alert({ message: "Popup blocked. Please allow popups for printing.", indicator: "orange" });
			return;
		}
		win.document.write(slipHTML);
		win.document.close();
		win.focus();
		setTimeout(() => win.print(), 400);
	}

	function flt(val, precision) {
		return parseFloat((+val || 0).toFixed(precision ?? 9));
	}

	// -------------------------------------------------------------------------
	// FAB injection
	// -------------------------------------------------------------------------

	function injectFAB() {
		if (document.getElementById(FAB_ID)) return;

		const btn = document.createElement("button");
		btn.id = FAB_ID;
		btn.title = "Billing Card";
		btn.innerHTML = `<span class="bc-icon">&#x1F4B3;</span><span>Billing Card</span>`;
		btn.addEventListener("click", openPanel);
		document.body.appendChild(btn);
	}

	function removeFAB() {
		document.getElementById(FAB_ID)?.remove();
		document.getElementById(PANEL_ID)?.remove();
		document.getElementById("bc-overlay")?.remove();
		document.getElementById("bc-extension-styles")?.remove();
		_panel = null;
		_overlay = null;
	}

	// -------------------------------------------------------------------------
	// Bootstrap — hook into POSAwesome page lifecycle
	// -------------------------------------------------------------------------

	function waitForPosApp(cb, maxMs) {
		const start = Date.now();
		const limit = maxMs || 20000;
		const t = setInterval(() => {
			if (frappe.PosApp?.posapp) {
				clearInterval(t);
				cb();
			} else if (Date.now() - start > limit) {
				clearInterval(t);
				console.warn("[BillingCard] Timed out waiting for POSAwesome.");
			}
		}, 200);
	}

	function initExtension() {
		injectStyles();
		waitForPosApp(() => {
			injectFAB();
		});
	}

	// Extend posapp page show/hide events without overwriting existing handlers
	(function hookPage() {
		const existingShow = frappe.pages["posapp"]?.on_page_show;
		const existingHide = frappe.pages["posapp"]?.on_page_hide;

		if (frappe.pages["posapp"]) {
			frappe.pages["posapp"].on_page_show = function (wrapper) {
				if (existingShow) existingShow.call(this, wrapper);
				initExtension();
			};

			frappe.pages["posapp"].on_page_hide = function (wrapper) {
				if (existingHide) existingHide.call(this, wrapper);
				// Remove FAB from previous session to keep DOM clean
				document.getElementById(FAB_ID)?.remove();
				_panel = null;
				_overlay = null;
			};
		} else {
			// page_js ran before frappe.pages["posapp"] was created — use on_page_load timing
			// This path is unlikely since page_js executes when the page loads.
			setTimeout(initExtension, 1000);
		}
	})();

	// Also handle immediate case where page is already shown (e.g. hot reload)
	if (document.getElementById("posapp-main") || document.querySelector(".main-section")?.children?.length) {
		initExtension();
	}
})();
