/**
 * Document templates for the Templates tab. Each renders as a starting
 * point for a fresh draft. Body is HTML (Tiptap accepts HTML on init).
 */

export interface DraftTemplate {
  id: string;
  label: string;
  description: string;
  defaultTitle: string;
  body: string;
}

export const DRAFT_TEMPLATES: ReadonlyArray<DraftTemplate> = [
  {
    id: 'memorandum',
    label: 'Privileged Memorandum',
    description: 'Standard internal memo with privilege header and signature block.',
    defaultTitle: 'Memorandum re: [Matter]',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT</strong></p>
<p><strong>TO:</strong> [Recipient]<br/>
<strong>FROM:</strong> [Drafter]<br/>
<strong>DATE:</strong> [Date]<br/>
<strong>RE:</strong> [Matter Caption]</p>
<hr/>
<h2>I. Background</h2>
<p></p>
<h2>II. Issues Presented</h2>
<p></p>
<h2>III. Brief Answer</h2>
<p></p>
<h2>IV. Analysis</h2>
<p></p>
<h2>V. Conclusion &amp; Recommendation</h2>
<p></p>
`,
  },
  {
    id: 'irac',
    label: 'IRAC Outline',
    description: 'Issue / Rule / Analysis / Conclusion structure.',
    defaultTitle: 'IRAC — [Issue]',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL</strong></p>
<h2>Issue</h2>
<p></p>
<h2>Rule</h2>
<p></p>
<h2>Analysis</h2>
<p></p>
<h2>Conclusion</h2>
<p></p>
`,
  },
  {
    id: 'risk',
    label: 'Risk Memorandum',
    description: 'Identifies risks, mitigations, and open questions.',
    defaultTitle: 'Risk Assessment — [Matter]',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT</strong></p>
<h2>Background</h2>
<p></p>
<h2>Identified Risks</h2>
<ol><li></li><li></li><li></li></ol>
<h2>Recommended Mitigations</h2>
<p></p>
<h2>Open Questions</h2>
<ul><li></li></ul>
`,
  },
  {
    id: 'redline',
    label: 'Redline Comments',
    description: 'Section-by-section markup notes.',
    defaultTitle: 'Redline — [Document]',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL</strong></p>
<h2>§ 1.</h2>
<blockquote><p>[Quoted clause]</p></blockquote>
<p>Comment: </p>
<h2>§ 2.</h2>
<blockquote><p>[Quoted clause]</p></blockquote>
<p>Comment: </p>
`,
  },
  {
    id: 'call',
    label: 'Call Notes',
    description: 'Attendees, discussion, action items.',
    defaultTitle: 'Call Notes — [Counterparty]',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL</strong></p>
<p><strong>Date:</strong> [Date]<br/>
<strong>Attendees:</strong> </p>
<h2>Discussion</h2>
<p></p>
<h2>Action Items</h2>
<ul><li>[ ] </li><li>[ ] </li></ul>
`,
  },
  {
    id: 'blank',
    label: 'Blank Document',
    description: 'No template — start fresh.',
    defaultTitle: 'Untitled Draft',
    body: '<p></p>',
  },
];

/**
 * DICTATION POOL — longer boilerplate bodies used exclusively by the
 * Templates page "Dictation" playback mode as transcription source text.
 * Deliberately kept OUT of DRAFT_TEMPLATES so they never appear in the
 * new-draft template picker.
 */
export const DICTATION_POOL_TEMPLATES: ReadonlyArray<DraftTemplate> = [
  {
    id: 'dictation-choice-of-law',
    label: 'Dictation Pool — Choice-of-Law Memorandum',
    description: 'Dictation-pool entry; not shown in the template picker.',
    defaultTitle: 'Memorandum — Choice of Law',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT</strong></p>
<p>This memorandum addresses whether the governing-law clause in Section 14.2 of the Master Services Agreement will be enforced as written, or whether a reviewing court is likely to apply the law of the forum notwithstanding the parties' express selection. For the reasons set out below, we conclude that the clause is very likely to be enforced, subject to the narrow public-policy exception discussed in Part III.</p>
<p>The parties negotiated the choice-of-law provision at arm's length, with the assistance of counsel on both sides, and the selected jurisdiction bears a reasonable relationship to the transaction. Courts in the relevant forum give substantial deference to contractual choice-of-law provisions where the chosen state has a substantial relationship to the parties or the transaction, or where there is any other reasonable basis for the parties' choice.</p>
<p>The principal exposure lies in the non-solicitation covenant. Restrictive covenants are the category of provision most frequently carved out of choice-of-law deference, because several states treat their own limits on such covenants as fundamental policy. If enforcement is sought against personnel resident in one of those states, the court may apply local law to that covenant while enforcing the remainder of the agreement as written.</p>
<p>We therefore recommend that the covenant be redrafted with a step-down structure and a severability clause tailored to the covenant itself, so that partial invalidation does not imperil the balance of the agreement. A proposed redline accompanies this memorandum under separate cover.</p>
`,
  },
  {
    id: 'dictation-litigation-hold',
    label: 'Dictation Pool — Litigation Hold Notice',
    description: 'Dictation-pool entry; not shown in the template picker.',
    defaultTitle: 'Litigation Hold — Preservation Notice',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL</strong></p>
<p>You are receiving this notice because the company reasonably anticipates litigation concerning the matters described below. Effective immediately, you must preserve all documents, communications, and electronically stored information that relate in any way to the subject matter of this notice, whether created before or after today's date.</p>
<p>The duty to preserve extends to email, instant messages, calendar entries, voicemail, text messages, shared-drive documents, collaboration-tool content, and any material stored on personal devices to the extent used for company business. Routine deletion practices, auto-archiving rules, and document-retention schedules are suspended with respect to covered materials until further written notice from the Legal Department.</p>
<p>Do not delete, alter, overwrite, or discard any covered material, and do not direct or permit anyone else to do so. If you believe a covered document has already been deleted or is at risk of automated deletion, contact the undersigned immediately so that recovery steps can be evaluated.</p>
<p>Please acknowledge receipt of this notice by return email within two business days. Your acknowledgment confirms that you have read the notice, that you understand its scope, and that you will comply with its terms until the hold is formally released.</p>
`,
  },
  {
    id: 'dictation-engagement',
    label: 'Dictation Pool — Engagement Terms',
    description: 'Dictation-pool entry; not shown in the template picker.',
    defaultTitle: 'Engagement Letter — Standard Terms',
    body: `
<p><strong>PRIVILEGED &amp; CONFIDENTIAL</strong></p>
<p>We are pleased to confirm the terms on which this firm will represent the company in connection with the matter described in the accompanying engagement summary. Our engagement is limited to that matter; we are not undertaking a general representation, and we assume no continuing obligation to advise on developments in the law after the engagement concludes.</p>
<p>Our fees will be based principally on the time devoted to the matter by the lawyers and paraprofessionals involved, at the hourly rates in effect when the services are performed. We will also charge for ancillary services and disbursements, including filing fees, expert charges, travel, and vendor costs for document hosting and review, in each case at cost and itemized on our monthly statements.</p>
<p>In the course of the engagement we will receive confidential information from you, and you may receive confidential information from us. Each party will maintain the confidentiality of the other's information in accordance with the applicable rules of professional conduct and any separate confidentiality agreement between us.</p>
<p>Either party may terminate the engagement at any time on written notice, subject to our obligations under the rules of professional conduct governing withdrawal. Upon termination, you will remain responsible for fees and charges incurred through the effective date of termination, together with any reasonable charges incurred in transferring the file at your direction.</p>
`,
  },
];
