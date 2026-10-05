# Field Naming Conventions Guide

**Version:** 2.0  
**Last Updated:** February 2026  
**Status:** Active Standard

## Overview

This guide defines the standardized field naming conventions for all legal document templates in the Dastavezai system. Following these conventions ensures:

- **Consistent data mapping** across 660+ templates
- **Predictable field extraction** from user input
- **Zero ambiguity** in placeholder identification
- **Maintainable codebase** with semantic field names
- **Better AI understanding** for chat-based document generation

## General Rules

### 1. Naming Format

```
{entity}_{attribute}[_{qualifier}]
```

**Examples:**
- `party_name` (entity: party, attribute: name)
- `witness_address` (entity: witness, attribute: address)
- `property_description_detailed` (entity: property, attribute: description, qualifier: detailed)

### 2. Character Rules

- ✅ **Use:** Lowercase letters, numbers, underscores only
- ✅ **Format:** `snake_case` (all lowercase with underscores)
- ❌ **Avoid:** Camelcase, spaces, hyphens, special characters
- ✅ **Length:** 3-40 characters (optimal: 10-25)

**Valid:**
```javascript
party_name
execution_date
property_address
```

**Invalid:**
```javascript
PartyName           // CamelCase
party-name          // Hyphen
party name          // Space
party.name          // Dot
pn                  // Too short
very_long_unnecessarily_descriptive_field_name_that_is_hard_to_read  // Too long
```

### 3. Generic Names to Avoid

**Never use these:**
- `field_value`, `field_value_2`, etc.
- `field_1`, `field_2`, etc.
- `value`, `data`, `input`
- `temp`, `placeholder`, `field`

**Instead, use semantic names that describe the content.**

---

## Standard Entity Prefixes

### Party-Related Fields

**Prefix:** `party_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `party_name` | text | Full legal name of party | "Rajesh Kumar Sharma" |
| `party_father_name` | text | Father's name (S/o context) | "Ramesh Sharma" |
| `party_address` | textarea | Complete address | "45 Nehru Nagar, Jaipur" |
| `party_age` | number | Age in years | 45 |
| `party_occupation` | text | Profession/occupation | "Advocate" |
| `party_phone` | phone | Contact number | "+91-9876543210" |
| `party_email` | email | Email address | "rajesh@email.com" |
| `party_aadhaar` | text | Aadhaar number | "1234-5678-9012" |
| `party_pan` | text | PAN card number | "ABCDE1234F" |

**For multiple parties:**
- `party_1_name`, `party_2_name`, etc.
- `plaintiff_name`, `defendant_name` (in litigation)
- `lessor_name`, `lessee_name` (in agreements)
- `buyer_name`, `seller_name` (in sale deeds)

### Witness Fields

**Prefix:** `witness_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `witness_name` | text | Witness full name | "Amit Verma" |
| `witness_address` | textarea | Witness address | "12 Gandhi Road, Delhi" |
| `witness_age` | number | Witness age | 38 |
| `witness_occupation` | text | Witness occupation | "Businessman" |
| `witness_signature` | text | Signature placeholder | "(Signature)" |

**For multiple witnesses:**
- `witness_1_name`, `witness_2_name`
- `witness_1_address`, `witness_2_address`

### Court and Legal Fields

**Prefix:** `court_*`, `case_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `court_name` | text | Court jurisdiction | "District Court, Mumbai" |
| `court_judge` | text | Presiding judge | "Hon'ble Justice R.K. Mehta" |
| `case_number` | text | Case/FIR number | "123/2025" |
| `case_title` | text | Case title | "Rajesh vs State of Maharashtra" |
| `case_year` | number | Year of filing | 2025 |
| `case_type` | text | Type of case | "Criminal/Civil" |
| `section_number` | text | IPC/Act section | "Section 420 IPC" |
| `fir_number` | text | FIR number | "FIR 456/2025" |
| `police_station` | text | Police station name | "Connaught Place PS" |

### Property Fields

**Prefix:** `property_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `property_address` | textarea | Property location | "Plot 45, Sector 12, Noida" |
| `property_description` | textarea | Detailed description | "2 BHK apartment, 1200 sq ft" |
| `property_area` | number | Area in sq ft/meters | 1200 |
| `property_boundaries_north` | text | Northern boundary | "Road" |
| `property_boundaries_south` | text | Southern boundary | "Plot 46" |
| `property_boundaries_east` | text | Eastern boundary | "Park" |
| `property_boundaries_west` | text | Western boundary | "Plot 44" |
| `property_survey_number` | text | Survey/Khasra number | "Survey No. 123/4" |
| `property_value` | amount | Market value | 5000000 |

### Financial Fields

**Prefix:** `amount`, `payment_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `amount` | amount | Primary amount | 100000 |
| `amount_words` | text | Amount in words | "One Lakh Rupees" |
| `payment_mode` | text | Mode of payment | "Cheque/Cash/Online" |
| `payment_date` | date | Payment date | "2025-02-12" |
| `cheque_number` | text | Cheque number | "456789" |
| `bank_name` | text | Bank name | "State Bank of India" |
| `account_number` | text | Account number | "12345678901" |
| `ifsc_code` | text | IFSC code | "SBIN0001234" |

### Date and Time Fields

**Prefix:** None (use descriptive names ending in `_date`)

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `execution_date` | date | Date of execution | "2025-02-12" |
| `agreement_date` | date | Agreement date | "2025-01-15" |
| `birth_date` | date | Date of birth | "1980-05-20" |
| `incident_date` | date | Date of incident | "2024-12-25" |
| `filing_date` | date | Date of filing | "2025-02-01" |
| `hearing_date` | date | Court hearing date | "2025-03-15" |

### Document Metadata

**Prefix:** `document_*`

| Field Key | Type | Description | Example Value |
|-----------|------|-------------|---------------|
| `document_title` | text | Document title | "Sale Deed" |
| `document_number` | text | Registration/ref number | "REG-2025-456" |
| `place_of_execution` | text | Execution place | "Mumbai" |
| `notary_name` | text | Notary public name | "Adv. Suresh Patel" |

---

## Indian Legal Field Conventions

### Relationship Nomenclature

Indian legal documents use specific relationship indicators:

| Convention | Field Name | Example |
|------------|------------|---------|
| S/o (Son of) | `father_name` | "Rajesh Kumar S/o Ramesh Kumar" |
| D/o (Daughter of) | `father_name` | "Priya Sharma D/o Vijay Sharma" |
| W/o (Wife of) | `husband_name` | "Sunita Devi W/o Anil Kumar" |
| R/o (Resident of) | `address` or `resident_of` | "R/o 45 Nehru Nagar" |

**Template usage:**
```
{{party_name}} S/o {{father_name}}, R/o {{address}}
```

### Age Representation

- Use `{entity}_age` format
- Type: `number`
- Include "aged" in template: `aged {{party_age}} years`

### Advocate/Legal Representative

| Field Key | Type | Description |
|-----------|------|-------------|
| `advocate_name` | text | Lawyer name |
| `advocate_enrollment` | text | Bar Council enrollment number |
| `advocate_address` | textarea | Advocate office address |

---

## Category-Specific Conventions

### Affidavit Templates

**Standard fields:**
- `deponent_name` (instead of party_name)
- `deponent_address`
- `deponent_age`
- `deponent_occupation`
- `affidavit_purpose`
- `facts_stated` (textarea)
- `verification_place`
- `verification_date`

### Bond Documents

**Standard fields:**
- `obligor_name` (person giving bond)
- `obligee_name` (person receiving bond)
- `bond_amount`
- `bond_purpose`
- `conditions` (array or textarea)
- `surety_name` (if applicable)
- `surety_address`

### Notice Templates

**Standard fields:**
- `sender_name`
- `sender_address`
- `recipient_name`
- `recipient_address`
- `notice_subject`
- `notice_details` (textarea)
- `compliance_days` (number)
- `legal_consequences` (textarea)

### Rental Agreements

**Standard fields:**
- `landlord_name` (instead of lessor)
- `tenant_name` (instead of lessee)
- `property_address`
- `rent_amount`
- `rent_period` (Monthly/Yearly)
- `security_deposit`
- `lease_start_date`
- `lease_end_date`
- `notice_period_days`
- `terms_conditions` (array)

### Writ Petitions

**Standard fields:**
- `petitioner_name`
- `respondent_name`
- `writ_type` (Habeas Corpus, Mandamus, etc.)
- `grievance_details` (textarea)
- `relief_sought` (textarea)
- `grounds` (array)
- `annexed_documents` (array)

---

## Field Type Guidelines

### Text vs Textarea

**Use `text` for:**
- Names (≤ 100 chars)
- Single-line addresses
- Numbers/codes
- Short descriptions

**Use `textarea` for:**
- Full addresses (multi-line)
- Detailed descriptions
- Terms and conditions
- Factual narratives
- Legal arguments

### Arrays

**Use `array` type for:**
- Multiple witnesses
- List of conditions
- Enumerated grounds
- Multiple properties

**Template syntax:**
```
Witnesses:
{{witnesses}}
```

**Data format:**
```javascript
{
  "witnesses": ["Witness 1 Name", "Witness 2 Name", "Witness 3 Name"]
}
```

**Rendered output:**
```
Witnesses:
1. Witness 1 Name
2. Witness 2 Name
3. Witness 3 Name
```

---

## Validation Requirements

### Required vs Optional

**Mark as required (`"required": true`) for:**
- Party names
- Addresses
- Dates of execution
- Core document content
- Legal identifiers

**Mark as optional for:**
- Secondary contact details
- Additional witnesses beyond minimum
- Optional clauses
- Supplementary information

### Field Lengths

```javascript
{
  "key": "party_name",
  "type": "text",
  "minLength": 2,
  "maxLength": 100
}
```

---

## Examples

### Complete Affidavit Field Schema

```json
{
  "title": "General Affidavit",
  "filename": "general-affidavit.docx",
  "category": "Affidavit Formats",
  "fields": [
    {
      "key": "deponent_name",
      "type": "text",
      "label": "Deponent Name",
      "required": true,
      "placeholder": "Full legal name"
    },
    {
      "key": "father_name",
      "type": "text",
      "label": "Father's Name (S/o)",
      "required": true,
      "placeholder": "Father's full name"
    },
    {
      "key": "deponent_age",
      "type": "number",
      "label": "Age",
      "required": true,
      "placeholder": "Age in years"
    },
    {
      "key": "deponent_address",
      "type": "textarea",
      "label": "Complete Address (R/o)",
      "required": true,
      "placeholder": "Full residential address"
    },
    {
      "key": "deponent_occupation",
      "type": "text",
      "label": "Occupation",
      "required": true,
      "placeholder": "e.g., Businessman"
    },
    {
      "key": "affidavit_purpose",
      "type": "text",
      "label": "Purpose of Affidavit",
      "required": true,
      "placeholder": "Brief purpose"
    },
    {
      "key": "facts_stated",
      "type": "textarea",
      "label": "Facts/Details",
      "required": true,
      "placeholder": "Detailed facts to be stated under oath"
    },
    {
      "key": "verification_place",
      "type": "text",
      "label": "Place of Verification",
      "required": true,
      "placeholder": "City name"
    },
    {
      "key": "verification_date",
      "type": "date",
      "label": "Date",
      "required": true,
      "placeholder": "YYYY-MM-DD"
    }
  ],
  "placeholder_order": [
    "deponent_name",
    "father_name",
    "deponent_age",
    "deponent_address",
    "deponent_occupation",
    "affidavit_purpose",
    "facts_stated",
    "verification_place",
    "verification_date"
  ]
}
```

### Template with {{placeholders}}

```
AFFIDAVIT

I, {{deponent_name}}, S/o {{father_name}}, aged {{deponent_age}} years, 
R/o {{deponent_address}}, occupation: {{deponent_occupation}}, do hereby 
solemnly affirm and state as under:

PURPOSE:
This affidavit is made for the purpose of {{affidavit_purpose}}.

FACTS:
{{facts_stated}}

VERIFICATION:
I verify that the contents of this affidavit are true and correct to the 
best of my knowledge and belief.

Place: {{verification_place}}
Date: {{verification_date}}

Signature: _________________
           {{deponent_name}}
```

---

## Migration from Old System

### Converting Generic Field Names

| Old (Generic) | New (Semantic) | Context |
|---------------|----------------|---------|
| `field_value` | `party_name` | When context is party name |
| `field_value_2` | `party_address` | When context is address |
| `field_1` | `execution_date` | When context is date |
| `field_2` | `witness_name` | When context is witness |

**Use the auto-fix script:**
```bash
node scripts/autofix_json_metadata.js
```

---

## Best Practices

### ✅ DO

- Use descriptive, semantic names
- Follow snake_case convention
- Group related fields with prefixes
- Include field label for UI display
- Mark fields as required appropriately
- Use correct field types
- Document complex fields

### ❌ DON'T

- Use generic names like `field_value`
- Mix naming conventions
- Create overly long names
- Forget `placeholder_order`
- Leave fields without labels
- Use incorrect types
- Duplicate field keys

---

## Support and Questions

For questions or suggestions about field naming conventions:

1. **Check this guide first** for standard patterns
2. **Review existing templates** in the same category
3. **Run validation scripts** to catch issues early
4. **Consult the development team** for edge cases

**Validation command:**
```bash
node scripts/validate_template_jsons.js
node scripts/test_all_templates.js
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024 | Initial conventions (informal) |
| 2.0 | Feb 2026 | Formalized standard with {{placeholder}} syntax |

---

**This is a living document. Suggest improvements via team discussion.**
