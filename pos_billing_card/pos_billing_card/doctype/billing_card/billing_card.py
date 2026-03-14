import frappe
from frappe.model.document import Document


class BillingCard(Document):
	def validate(self):
		if self.status == "Available":
			self.customer = None
			self.current_invoice = None
			self.current_floor = None
			self.assigned_at = None
			self.assigned_by = None

	def before_rename(self, old, new, merge=False):
		frappe.throw("Billing cards cannot be renamed. The card number is printed on the physical card.")
