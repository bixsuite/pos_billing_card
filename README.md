# POS Billing Card

Multi-floor retail token / billing card system for ERPNext 15 + POSAwesome.

Customers carry a physical card through the showroom. Each floor adds items to the card. The cash counter loads all items and processes a single payment.

## Workflow

```
Customer enters showroom
       │
       ▼
Floor staff selects customer in POSAwesome Customer Details section
  → Click the 💳 Billing Card button (appears at the right of the "Customer Details" heading)
  → Scan or type card number → Card is "Available"
  → Select floor → Click "Assign Card to Customer"
  → Draft POS Invoice created and linked to card
       │
       ▼
Staff adds items normally in POSAwesome
  → Click "Save Current POS Items to Card"  (items stored in card's draft invoice)
  → Optional: Click "Print Floor Slip"
  → Customer takes card to next floor
       │
       ▼
Next floor — staff scans card
  → Existing items from previous floors load automatically
  → More items added → Save to Card again
       │
       ▼
Customer reaches Cash Counter
  → Cashier scans card → Click "Load Items into POS"
  → All items from all floors appear in POSAwesome
  → Process payment normally (cash / card / UPI / etc.)
  → Card is auto-released on payment submission
  → Or manually click "Release Card" if needed
```

## Installation

```bash
# 1. Get the app
bench get-app pos_billing_card https://github.com/bixsuite/pos_billing_card

# 2. Install on site (creates Billing Card doctype + applies custom field fixtures)
bench --site <site> install-app pos_billing_card

# 3. Build assets and clear cache
bench build --app pos_billing_card
bench --site <site> clear-cache
```

> **Note:** Do not run `import-fixtures` manually before `install-app`. The custom fields
> link to the Billing Card doctype, which must exist first. The `after_install` hook handles this.

## Create Physical Cards

Go to **Billing Card** list → click **Bulk Create Cards** (toolbar button) to create cards from the UI.

Or from the terminal:

```bash
bench --site <site> execute pos_billing_card.api.billing_card_api.bulk_create_cards \
  --args '{"count": 50, "prefix": "BC-"}'
```

This creates BC-01 … BC-50 with status "Available".

## Usage

### Floor Staff

1. Open POSAwesome (`/app/posapp`)
2. Select the customer in the **Customer Details** section
3. Click the **💳 Billing Card** button (right side of the Customer Details heading)
4. Scan or type the card number → click **Scan**
5. If card is **Available**: select floor → click **Assign Card to Customer**
6. Add items in POSAwesome normally
7. Click **Save Current POS Items to Card** to persist items
8. Optionally click **Print Floor Slip**
9. Customer takes card to the next floor

### Next Floors

Same as above — scan card → existing items load automatically → add more → save.

### Cash Counter

1. Scan card → click **Load Items into POS**
2. All items from all floors appear in POSAwesome
3. Process payment normally in POSAwesome
4. Card is **auto-released** when the invoice is submitted
5. Or manually click **Release Card** if needed

### Invoice Management / Load Drafts

If a cashier opens an existing draft invoice that already has a billing card linked, the **💳 Billing Card** badge in the Customer Details heading updates automatically to show the active card.

## Applying Updates

After pulling new code:

```bash
# Python-only changes
bench --site <site> clear-cache

# JS changes (always include build)
bench build --app pos_billing_card
bench --site <site> clear-cache

# Schema changes
bench --site <site> migrate
bench build --app pos_billing_card
bench --site <site> clear-cache
```

## File Structure

```
pos_billing_card/
├── pos_billing_card/
│   ├── hooks.py                          # page_js + fixtures + doc_events + after_install
│   ├── setup.py                          # after_install: reload_doc + sync_fixtures
│   ├── modules.txt
│   ├── pos_billing_card/
│   │   └── doctype/billing_card/
│   │       ├── billing_card.json         # DocType definition
│   │       ├── billing_card.py           # Controller
│   │       └── billing_card_list.js      # List view — Bulk Create Cards toolbar button
│   ├── api/
│   │   └── billing_card_api.py           # All whitelisted API endpoints
│   ├── fixtures/
│   │   └── custom_field.json             # bc_billing_card + bc_floor on POS Invoice & Sales Invoice
│   └── public/js/
│       └── pos_billing_card_extension.js # POSAwesome slide panel UI (injected via page_js)
└── pyproject.toml
```

## Custom Fields Added

| Doctype | Field | Type | Purpose |
|---|---|---|---|
| POS Invoice | `bc_billing_card` | Link → Billing Card | Links invoice to card |
| POS Invoice | `bc_floor` | Data | Floor where items were added |
| Sales Invoice | `bc_billing_card` | Link → Billing Card | Visible in standard invoice list |
| Sales Invoice | `bc_floor` | Data | Floor reference |
