
export const documentSchemas = {
  
  'MOU / NDA': {
    displayName: 'Memorandum of Understanding / Non-Disclosure Agreement',
    subtypes: {
      'Business Partnership MOU': {
        displayName: 'Business Partnership MOU',
        description: 'Agreement outlining terms of business collaboration',
        fields: [
          { key: 'party1_name', label: 'First Party Name', description: 'Name of first party/company', required: true },
          { key: 'party1_address', label: 'First Party Address', description: 'Complete address of first party', required: true },
          { key: 'party2_name', label: 'Second Party Name', description: 'Name of second party/company', required: true },
          { key: 'party2_address', label: 'Second Party Address', description: 'Complete address of second party', required: true },
          { key: 'purpose', label: 'Purpose of MOU', description: 'What is the collaboration about', required: true },
          { key: 'scope_of_work', label: 'Scope of Work', description: 'Detailed scope of collaboration', required: true },
          { key: 'duration', label: 'Duration', description: 'Validity period (e.g., 2 years)', required: true },
          { key: 'responsibilities_party1', label: 'First Party Responsibilities', description: 'What first party will do', required: false },
          { key: 'responsibilities_party2', label: 'Second Party Responsibilities', description: 'What second party will do', required: false },
          { key: 'financial_terms', label: 'Financial Terms', description: 'Payment/cost sharing details if any', required: false },
          { key: 'termination_clause', label: 'Termination Terms', description: 'How can this MOU be terminated', required: false },
        ]
      },
      'Employment NDA': {
        displayName: 'Employment Non-Disclosure Agreement',
        description: 'Confidentiality agreement between employer and employee',
        fields: [
          { key: 'company_name', label: 'Company Name', description: 'Name of the company', required: true },
          { key: 'company_address', label: 'Company Address', description: 'Registered address of company', required: true },
          { key: 'employee_name', label: 'Employee Name', description: 'Name of the employee', required: true },
          { key: 'employee_address', label: 'Employee Address', description: 'Address of the employee', required: true },
          { key: 'designation', label: 'Employee Designation', description: 'Job title/position', required: true },
          { key: 'confidential_info', label: 'Confidential Information', description: 'What information is confidential', required: true },
          { key: 'duration', label: 'NDA Duration', description: 'How long does NDA last (e.g., 2 years after employment ends)', required: true },
          { key: 'permitted_disclosure', label: 'Permitted Disclosures', description: 'Exceptions where disclosure is allowed', required: false },
          { key: 'consequences', label: 'Breach Consequences', description: 'Penalties for breach of NDA', required: false },
        ]
      },
      'Mutual NDA': {
        displayName: 'Mutual Non-Disclosure Agreement',
        description: 'Two-way NDA where both parties share confidential information',
        fields: [
          { key: 'party1_name', label: 'First Party Name', description: 'Name of first party/company', required: true },
          { key: 'party1_address', label: 'First Party Address', description: 'Complete address of first party', required: true },
          { key: 'party2_name', label: 'Second Party Name', description: 'Name of second party/company', required: true },
          { key: 'party2_address', label: 'Second Party Address', description: 'Complete address of second party', required: true },
          { key: 'purpose', label: 'Purpose', description: 'Purpose of information sharing (e.g., evaluating business partnership)', required: true },
          { key: 'confidential_info', label: 'Confidential Information', description: 'Types of information covered', required: true },
          { key: 'duration', label: 'NDA Duration', description: 'How long does NDA last', required: true },
          { key: 'exclusions', label: 'Exclusions', description: 'Information not covered by NDA', required: false },
        ]
      },
      'Technology Transfer MOU': {
        displayName: 'Technology Transfer MOU',
        description: 'Agreement for transfer of technical know-how',
        fields: [
          { key: 'licensor_name', label: 'Licensor Name', description: 'Party transferring technology', required: true },
          { key: 'licensor_address', label: 'Licensor Address', description: 'Address of licensor', required: true },
          { key: 'licensee_name', label: 'Licensee Name', description: 'Party receiving technology', required: true },
          { key: 'licensee_address', label: 'Licensee Address', description: 'Address of licensee', required: true },
          { key: 'technology_description', label: 'Technology Description', description: 'What technology is being transferred', required: true },
          { key: 'license_type', label: 'License Type', description: 'Exclusive or non-exclusive', required: true },
          { key: 'territory', label: 'Geographic Territory', description: 'Where can technology be used', required: true },
          { key: 'duration', label: 'Duration', description: 'License validity period', required: true },
          { key: 'royalty_terms', label: 'Royalty/Payment Terms', description: 'Financial terms of the agreement', required: true },
          { key: 'support_training', label: 'Support & Training', description: 'Technical support and training details', required: false },
        ]
      },
      'Real Estate MOU': {
        displayName: 'Real Estate MOU',
        description: 'Preliminary agreement for property transaction',
        fields: [
          { key: 'seller_name', label: 'Seller/Owner Name', description: 'Name of property owner', required: true },
          { key: 'seller_address', label: 'Seller Address', description: 'Address of seller', required: true },
          { key: 'buyer_name', label: 'Buyer Name', description: 'Name of prospective buyer', required: true },
          { key: 'buyer_address', label: 'Buyer Address', description: 'Address of buyer', required: true },
          { key: 'property_description', label: 'Property Description', description: 'Details of the property', required: true },
          { key: 'property_address', label: 'Property Location', description: 'Full address of property', required: true },
          { key: 'proposed_price', label: 'Proposed Sale Price', description: 'Intended sale amount', required: true },
          { key: 'earnest_money', label: 'Earnest Money', description: 'Amount paid as advance/token', required: false },
          { key: 'due_diligence_period', label: 'Due Diligence Period', description: 'Time for buyer to verify property', required: true },
          { key: 'final_agreement_timeline', label: 'Final Agreement Timeline', description: 'When will final sale deed be executed', required: true },
        ]
      },
      'Joint Venture MOU': {
        displayName: 'Joint Venture MOU',
        description: 'Agreement for collaborative business venture',
        fields: [
          { key: 'party1_name', label: 'First Party Name', description: 'First JV partner', required: true },
          { key: 'party1_address', label: 'First Party Address', description: 'Address of first party', required: true },
          { key: 'party2_name', label: 'Second Party Name', description: 'Second JV partner', required: true },
          { key: 'party2_address', label: 'Second Party Address', description: 'Address of second party', required: true },
          { key: 'venture_purpose', label: 'Venture Purpose', description: 'What is the joint venture for', required: true },
          { key: 'equity_split', label: 'Equity/Profit Split', description: 'How will ownership/profits be divided', required: true },
          { key: 'capital_contribution', label: 'Capital Contributions', description: 'Investment by each party', required: true },
          { key: 'management_structure', label: 'Management Structure', description: 'How will venture be managed', required: true },
          { key: 'duration', label: 'Duration', description: 'Validity period of JV', required: true },
          { key: 'exit_terms', label: 'Exit Terms', description: 'How can a party exit the JV', required: false },
        ]
      },
      'Vendor NDA': {
        displayName: 'Vendor/Supplier NDA',
        description: 'NDA between company and vendor/supplier',
        fields: [
          { key: 'company_name', label: 'Company Name', description: 'Name of the company', required: true },
          { key: 'company_address', label: 'Company Address', description: 'Company address', required: true },
          { key: 'vendor_name', label: 'Vendor Name', description: 'Name of vendor/supplier', required: true },
          { key: 'vendor_address', label: 'Vendor Address', description: 'Vendor address', required: true },
          { key: 'services_description', label: 'Services/Goods', description: 'What vendor will provide', required: true },
          { key: 'confidential_info', label: 'Confidential Information', description: 'What information is confidential', required: true },
          { key: 'duration', label: 'NDA Duration', description: 'How long does NDA last', required: true },
        ]
      }
    }
  },

  
  'Employment Contract': {
    displayName: 'Employment Contract',
    description: 'Formal employment agreement between employer and employee',
    fields: [
      { key: 'company_name', label: 'Company Name', description: 'Name of the employer', required: true },
      { key: 'company_address', label: 'Company Address', description: 'Registered address', required: true },
      { key: 'employee_name', label: 'Employee Name', description: 'Name of the employee', required: true },
      { key: 'employee_address', label: 'Employee Address', description: 'Residential address', required: true },
      { key: 'designation', label: 'Designation/Position', description: 'Job title', required: true },
      { key: 'start_date', label: 'Start Date', description: 'Employment start date', required: true },
      { key: 'salary', label: 'Salary/CTC', description: 'Annual salary or CTC', required: true },
      { key: 'working_hours', label: 'Working Hours', description: 'Daily/weekly working hours', required: true },
      { key: 'probation_period', label: 'Probation Period', description: 'Probation duration if any', required: false },
      { key: 'leave_policy', label: 'Leave Policy', description: 'Annual leave entitlement', required: false },
      { key: 'notice_period', label: 'Notice Period', description: 'Notice period for resignation', required: true },
      { key: 'job_description', label: 'Job Description', description: 'Key responsibilities', required: true },
    ]
  },

  'Service Agreement': {
    displayName: 'Service Agreement',
    description: 'Agreement for provision of professional services',
    fields: [
      { key: 'service_provider_name', label: 'Service Provider Name', description: 'Name of person/company providing services', required: true },
      { key: 'provider_address', label: 'Provider Address', description: 'Address of service provider', required: true },
      { key: 'client_name', label: 'Client Name', description: 'Name of client', required: true },
      { key: 'client_address', label: 'Client Address', description: 'Address of client', required: true },
      { key: 'services_description', label: 'Services Description', description: 'Detailed description of services', required: true },
      { key: 'service_fee', label: 'Service Fee', description: 'Payment amount and terms', required: true },
      { key: 'payment_schedule', label: 'Payment Schedule', description: 'When and how payment will be made', required: true },
      { key: 'duration', label: 'Contract Duration', description: 'Start and end dates', required: true },
      { key: 'deliverables', label: 'Deliverables', description: 'What will be delivered', required: false },
      { key: 'termination_terms', label: 'Termination Terms', description: 'How can contract be terminated', required: false },
    ]
  },

  'Loan Agreement': {
    displayName: 'Loan Agreement',
    description: 'Agreement for lending money',
    fields: [
      { key: 'lender_name', label: 'Lender Name', description: 'Name of person lending money', required: true },
      { key: 'lender_address', label: 'Lender Address', description: 'Address of lender', required: true },
      { key: 'borrower_name', label: 'Borrower Name', description: 'Name of person borrowing money', required: true },
      { key: 'borrower_address', label: 'Borrower Address', description: 'Address of borrower', required: true },
      { key: 'loan_amount', label: 'Loan Amount', description: 'Amount being lent', required: true },
      { key: 'interest_rate', label: 'Interest Rate', description: 'Annual interest rate (%)', required: true },
      { key: 'loan_purpose', label: 'Purpose of Loan', description: 'What loan is for', required: false },
      { key: 'repayment_schedule', label: 'Repayment Schedule', description: 'How and when will loan be repaid', required: true },
      { key: 'loan_tenure', label: 'Loan Tenure', description: 'Duration of loan', required: true },
      { key: 'security_collateral', label: 'Security/Collateral', description: 'Any assets pledged as security', required: false },
      { key: 'default_terms', label: 'Default Terms', description: 'Consequences of non-payment', required: false },
    ]
  },

  
  'Company Incorporation': {
    displayName: 'Company Incorporation Application',
    description: 'Application for registering a new company',
    fields: [
      { key: 'company_name', label: 'Proposed Company Name', description: 'Name of the company', required: true },
      { key: 'company_type', label: 'Company Type', description: 'Private Limited, LLP, etc.', required: true },
      { key: 'registered_office', label: 'Registered Office Address', description: 'Complete address', required: true },
      { key: 'business_activity', label: 'Main Business Activity', description: 'What will company do', required: true },
      { key: 'authorized_capital', label: 'Authorized Capital', description: 'Total authorized share capital', required: true },
      { key: 'directors', label: 'Directors Details', description: 'Names and addresses of directors', required: true },
      { key: 'shareholders', label: 'Shareholders Details', description: 'Names and shareholding', required: true },
    ]
  },

  'Franchise Agreement': {
    displayName: 'Franchise Agreement',
    description: 'Agreement for granting franchise rights',
    fields: [
      { key: 'franchisor_name', label: 'Franchisor Name', description: 'Company granting franchise', required: true },
      { key: 'franchisor_address', label: 'Franchisor Address', description: 'Address of franchisor', required: true },
      { key: 'franchisee_name', label: 'Franchisee Name', description: 'Person/entity taking franchise', required: true },
      { key: 'franchisee_address', label: 'Franchisee Address', description: 'Address of franchisee', required: true },
      { key: 'franchise_territory', label: 'Territory', description: 'Geographic area of franchise', required: true },
      { key: 'franchise_fee', label: 'Franchise Fee', description: 'Initial franchise fee', required: true },
      { key: 'royalty_fee', label: 'Royalty Fee', description: 'Ongoing royalty percentage', required: true },
      { key: 'duration', label: 'Franchise Duration', description: 'Term of franchise agreement', required: true },
      { key: 'training_support', label: 'Training & Support', description: 'Support provided by franchisor', required: false },
      { key: 'renewal_terms', label: 'Renewal Terms', description: 'Terms for renewing franchise', required: false },
    ]
  },

  'Shareholder Agreement': {
    displayName: 'Shareholder Agreement',
    description: 'Agreement between shareholders of a company',
    fields: [
      { key: 'company_name', label: 'Company Name', description: 'Name of the company', required: true },
      { key: 'shareholders', label: 'Shareholders Details', description: 'Names and shareholding of all shareholders', required: true },
      { key: 'voting_rights', label: 'Voting Rights', description: 'How voting rights are distributed', required: true },
      { key: 'dividend_policy', label: 'Dividend Policy', description: 'How profits will be distributed', required: true },
      { key: 'transfer_restrictions', label: 'Share Transfer Restrictions', description: 'Rules for transferring shares', required: true },
      { key: 'board_composition', label: 'Board Composition', description: 'How board of directors is formed', required: true },
      { key: 'dispute_resolution', label: 'Dispute Resolution', description: 'How disputes will be resolved', required: false },
      { key: 'exit_mechanism', label: 'Exit Mechanism', description: 'How shareholders can exit', required: false },
    ]
  },

  
  'Anticipatory Bail': {
    displayName: 'Anticipatory Bail Application',
    description: 'Application for bail in anticipation of arrest',
    fields: [
      { key: 'applicant_name', label: 'Applicant Name', description: 'Name of person seeking bail', required: true },
      { key: 'applicant_address', label: 'Applicant Address', description: 'Residential address', required: true },
      { key: 'fir_number', label: 'FIR Number', description: 'FIR number if already registered', required: false },
      { key: 'police_station', label: 'Police Station', description: 'Police station where FIR registered/likely to be registered', required: true },
      { key: 'offence_details', label: 'Offence Details', description: 'What are the allegations', required: true },
      { key: 'grounds_for_bail', label: 'Grounds for Anticipatory Bail', description: 'Why bail should be granted', required: true },
      { key: 'previous_record', label: 'Previous Criminal Record', description: 'Any past cases (if none, write "None")', required: true },
      { key: 'sureties', label: 'Surety Details', description: 'Details of persons standing surety', required: false },
    ]
  },

  'Caveat': {
    displayName: 'Caveat Application',
    description: 'Application to get notice of any proceedings',
    fields: [
      { key: 'caveator_name', label: 'Caveator Name', description: 'Name of person filing caveat', required: true },
      { key: 'caveator_address', label: 'Caveator Address', description: 'Address of caveator', required: true },
      { key: 'likely_applicant', label: 'Likely Applicant', description: 'Name of person who may file case', required: true },
      { key: 'matter_details', label: 'Matter Details', description: 'What is the dispute about', required: true },
      { key: 'reason_for_caveat', label: 'Reason for Caveat', description: 'Why are you filing caveat', required: true },
    ]
  },

  
  'Name Change Affidavit': {
    displayName: 'Name Change Affidavit',
    description: 'Affidavit for declaring name change',
    fields: [
      { key: 'old_name', label: 'Old Name', description: 'Current name as in documents', required: true },
      { key: 'new_name', label: 'New Name', description: 'Name you want to change to', required: true },
      { key: 'father_name', label: 'Father\'s Name', description: 'Name of your father', required: true },
      { key: 'address', label: 'Address', description: 'Your residential address', required: true },
      { key: 'dob', label: 'Date of Birth', description: 'Your date of birth', required: true },
      { key: 'reason', label: 'Reason for Change', description: 'Why you want to change name', required: true },
    ]
  },

  'Guardianship Application': {
    displayName: 'Guardianship Application',
    description: 'Application for appointment as guardian',
    fields: [
      { key: 'applicant_name', label: 'Applicant Name', description: 'Name of person seeking guardianship', required: true },
      { key: 'applicant_address', label: 'Applicant Address', description: 'Address of applicant', required: true },
      { key: 'minor_name', label: 'Minor\'s Name', description: 'Name of the child/minor', required: true },
      { key: 'minor_dob', label: 'Minor\'s Date of Birth', description: 'Date of birth of minor', required: true },
      { key: 'relationship', label: 'Relationship with Minor', description: 'Your relationship to the child', required: true },
      { key: 'reason', label: 'Reason for Guardianship', description: 'Why guardianship is needed', required: true },
      { key: 'assets', label: 'Minor\'s Assets', description: 'Details of any property/assets of minor', required: false },
    ]
  },

  
  'Defamation Notice': {
    displayName: 'Defamation Notice',
    description: 'Legal notice for defamatory statements',
    fields: [
      { key: 'sender_name', label: 'Your Name', description: 'Name of person sending notice', required: true },
      { key: 'sender_address', label: 'Your Address', description: 'Your address', required: true },
      { key: 'recipient_name', label: 'Recipient Name', description: 'Name of person to whom notice is sent', required: true },
      { key: 'recipient_address', label: 'Recipient Address', description: 'Address of recipient', required: true },
      { key: 'defamatory_statement', label: 'Defamatory Statement', description: 'What was said/written', required: true },
      { key: 'publication_details', label: 'Publication Details', description: 'Where and when it was published', required: true },
      { key: 'damage_caused', label: 'Damage Caused', description: 'How it harmed your reputation', required: true },
      { key: 'demand', label: 'Demand', description: 'What you want (apology, compensation, etc.)', required: true },
    ]
  },

  'RTI Application': {
    displayName: 'RTI Application',
    description: 'Right to Information application',
    fields: [
      { key: 'applicant_name', label: 'Applicant Name', description: 'Your name', required: true },
      { key: 'applicant_address', label: 'Applicant Address', description: 'Your complete address', required: true },
      { key: 'department', label: 'Department/Office', description: 'Which government office', required: true },
      { key: 'information_sought', label: 'Information Sought', description: 'What information do you want', required: true },
      { key: 'period', label: 'Period', description: 'Time period for which info is sought', required: false },
      { key: 'reason', label: 'Reason (Optional)', description: 'Why you need this information', required: false },
    ]
  },

  'Affidavit (General)': {
    displayName: 'General Affidavit',
    description: 'General purpose affidavit',
    fields: [
      { key: 'deponent_name', label: 'Your Name', description: 'Name of person making affidavit', required: true },
      { key: 'father_name', label: 'Father\'s/Husband\'s Name', description: 'Father or husband name', required: true },
      { key: 'address', label: 'Address', description: 'Your residential address', required: true },
      { key: 'purpose', label: 'Purpose', description: 'What is this affidavit for', required: true },
      { key: 'facts', label: 'Facts/Statement', description: 'Details you want to declare under oath', required: true },
    ]
  }
};

export function getDocumentSchema(documentType) {
  const normalized = documentType.trim();
  
  
  if (documentSchemas[normalized]) {
    return documentSchemas[normalized];
  }
  
  
  for (const [key, value] of Object.entries(documentSchemas)) {
    if (key.toLowerCase() === normalized.toLowerCase()) {
      return value;
    }
  }
  
  return null;
}

export function hasSubtypes(documentType) {
  const schema = getDocumentSchema(documentType);
  return schema && schema.subtypes && Object.keys(schema.subtypes).length > 0;
}

export function getSubtypes(documentType) {
  const schema = getDocumentSchema(documentType);
  if (!schema || !schema.subtypes) return [];
  
  return Object.keys(schema.subtypes);
}

export function getSubtypeSchema(documentType, subtype) {
  const schema = getDocumentSchema(documentType);
  if (!schema || !schema.subtypes) return null;
  
  return schema.subtypes[subtype] || null;
}
