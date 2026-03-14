app_name = "pos_billing_card"
app_title = "POS Billing Card"
app_publisher = "Bixsuite"
app_description = "Billing Card / Token system for multi-floor clothing retail showroom"
app_email = "hello@bixsuite.com"
app_license = "mit"

# Inject our extension JS into the POSAwesome posapp page
page_js = {
	"posapp": "public/js/pos_billing_card_extension.js"
}

# Fixtures — syncs custom fields added to POS Invoice / Sales Invoice
fixtures = [
	{
		"dt": "Custom Field",
		"filters": [
			["dt", "in", ["POS Invoice", "Sales Invoice"]],
			["fieldname", "like", "bc_%"],
		],
	}
]

# Auto-release billing card when POS Invoice is submitted via normal POSAwesome flow
doc_events = {
	"POS Invoice": {
		"on_submit": "pos_billing_card.api.billing_card_api.on_pos_invoice_submit",
	}
}
