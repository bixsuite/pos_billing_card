frappe.listview_settings["Billing Card"] = {
	onload(listview) {
		listview.page.add_inner_button(__("Bulk Create Cards"), () => {
			const d = new frappe.ui.Dialog({
				title: __("Bulk Create Billing Cards"),
				fields: [
					{
						fieldname: "prefix",
						fieldtype: "Data",
						label: __("Card Prefix"),
						default: "BC-",
						reqd: 1,
						description: __('e.g. "BC-" → BC-001, BC-002 …'),
					},
					{
						fieldname: "count",
						fieldtype: "Int",
						label: __("Number of Cards"),
						default: 10,
						reqd: 1,
					},
				],
				primary_action_label: __("Create"),
				primary_action({ prefix, count }) {
					if (!count || count < 1 || count > 500) {
						frappe.msgprint(__("Count must be between 1 and 500."));
						return;
					}
					d.disable_primary_action();
					frappe.call({
						method: "pos_billing_card.api.billing_card_api.bulk_create_cards",
						args: { prefix, count },
						callback(r) {
							d.hide();
							const { created, skipped } = r.message;
							frappe.show_alert(
								{
									message: __(
										`Created {0} card(s)` +
											(skipped ? `, skipped {1} existing.` : "."),
										[created, skipped]
									),
									indicator: "green",
								},
								5
							);
							listview.refresh();
						},
						error() {
							d.enable_primary_action();
						},
					});
				},
			});
			d.show();
		});
	},
};
