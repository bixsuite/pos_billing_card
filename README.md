# POS Billing Card

Multi-floor retail token / billing card system for ERPNext 15 + POSAwesome.

## Workflow

```
Customer enters showroom
       │
       ▼
Floor staff scans/enters card number in POSAwesome
  → Card is "Available" → Assign to customer → Draft POS Invoice created
       │
       ▼
Staff adds items normally in POSAwesome
       │
       ▼
Click "Save Current POS Items to Card"  (items stored in draft invoice)
  → Optional: Print Floor Slip
       │
       ▼
Customer moves to next floor (shows card)
  → Floor staff scans card → existing items load into POSAwesome
  → More items added → Save to Card again
       │
       ▼
Customer reaches Cash Counter
  → Cashier scans card → all items from all floors load into POSAwesome
  → Normal POSAwesome payment (cash / card / UPI / etc.)
  → After payment: click "Release Card" → card is Available for next customer
```

## Installation

```bash
# 1. Get the app (if not already cloned)
bench get-app pos_billing_card https://github.com/bixsuite/pos_billing_card

# 2. Install on site
# This runs migrate (creates Billing Card doctype) and then applies fixtures
# (custom fields on POS Invoice / Sales Invoice) via the after_install hook.
bench --site <site> install-app pos_billing_card

# 3. Clear cache and rebuild assets
bench --site <site> clear-cache
bench build --app pos_billing_card
```

> **Note:** Do not run `import-fixtures` manually before `install-app` — the
> custom fields link to the Billing Card doctype, which must exist in the
> database first. The `after_install` hook handles this automatically.

## Usage

### Create Physical Cards

Go to **Billing Card** list and create cards manually, or use bulk creation from the terminal:

```bash
# Creates BC-01 … BC-50, all status "Available"
bench --site <site> execute pos_billing_card.api.billing_card_api.bulk_create_cards --args '{"count": 50, "prefix": "BC-"}'
```

This creates BC-01 … BC-50 with status "Available".

### Floor Staff

1. Open POSAwesome (`/app/posapp`)
2. Click the **Billing Card** button (bottom-right corner)
3. Scan or type card number → click **Scan**
4. If card is **Available**: assign to customer (type name or use current POS customer)
5. Add items in POSAwesome normally
6. Click **Save Current POS Items to Card** to persist items
7. Optionally click **Print Floor Slip**
8. Customer takes card to next floor

### Next Floors

Same as above — scan card → items load automatically → add more → save.

### Cash Counter

1. Scan card → click **Load Items into POS**
2. All items from all floors appear in POSAwesome
3. Process payment normally in POSAwesome
4. After submission, the card is **auto-released** (via doc event hook)
5. Or manually click **Release Card** if needed

## File Structure

```
pos_billing_card/
├── pos_billing_card/
│   ├── hooks.py                          # page_js + fixtures + doc_events
│   ├── modules.txt
│   ├── doctype/billing_card/
│   │   ├── billing_card.json             # DocType definition
│   │   └── billing_card.py              # Controller (validate/rename guard)
│   ├── api/
│   │   └── billing_card_api.py          # All whitelisted API endpoints
│   ├── fixtures/
│   │   └── custom_field.json            # bc_billing_card + bc_floor on POS Invoice
│   └── public/js/
│       └── pos_billing_card_extension.js # POSAwesome FAB + slide panel UI
└── pyproject.toml
```
