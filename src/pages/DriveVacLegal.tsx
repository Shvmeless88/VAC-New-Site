import { Link } from 'react-router-dom';
import Logo from '@/components/layout/Logo';
import { ArrowLeft } from 'lucide-react';

// Original Vehicle Approval Centre policies, written to cover the standard sections a Canadian
// lead-generation service needs (PIPEDA + CASL). Update LAST_UPDATED and the
// contact addresses below when anything material changes.
const LAST_UPDATED = 'August 3, 2026';

type Section = { h: string; p: string[] };

const PRIVACY: Section[] = [
  {
    h: 'Who we are',
    p: [
      'Vehicle Approval Centre ("Vehicle Approval Centre", "we", "us", or "our") operates apply.vehicleapprovalcentre.com, a lead-generation service that connects Canadians seeking vehicle financing with automotive dealer and financing partners. We are committed to protecting your privacy and handling your personal information in accordance with Canada\'s Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial law.',
      'This Privacy Policy explains what we collect, how we use and share it, and the choices you have.',
    ],
  },
  {
    h: 'Information we collect',
    p: [
      'When you use our application, we collect the information you provide, which may include: your name, date of birth, email address, phone number and residential address; your employment status and details, income and credit self-assessment; your driver\'s licence and residency status; and your vehicle preferences, budget, trade-in and down-payment information.',
      'We also automatically collect technical information such as your IP address, device and browser type, and marketing/referral parameters (for example, UTM tags) that tell us how you reached our site.',
    ],
  },
  {
    h: 'How we use your information',
    p: [
      'We use your information to match you with dealer and financing partners; to allow those partners to contact you about vehicle financing and purchase options; to operate, secure, and improve our service; and to comply with our legal obligations.',
    ],
  },
  {
    h: 'How we share your information with dealer partners',
    p: [
      'Our core service is connecting you with dealer and financing partners. By submitting an application, you consent to Vehicle Approval Centre sharing — and in some cases selling — the information you provide to one or more such partners so that they may contact you.',
      'These partners are independent businesses with their own privacy practices. Once your information is shared with a partner, that partner\'s use of it is governed by the partner\'s own privacy policy, not this one.',
      'We may also share information with service providers who help us operate (such as hosting and analytics providers), and where we are required or permitted to do so by law.',
    ],
  },
  {
    h: 'Your consent',
    p: [
      'We collect, use, and disclose your personal information with your consent, which you provide expressly when you submit your application. You may withdraw your consent at any time, subject to legal or contractual restrictions, by contacting us at privacy@vehicleapprovalcentre.com. Withdrawing consent may prevent us from providing the service.',
    ],
  },
  {
    h: 'Retention',
    p: [
      'We retain your personal information only for as long as necessary to fulfil the purposes described in this policy or as required by law, after which it is securely deleted or de-identified.',
    ],
  },
  {
    h: 'Security',
    p: [
      'We use reasonable administrative, technical, and physical safeguards — including encryption in transit — to protect your personal information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.',
    ],
  },
  {
    h: 'Storage and cross-border transfers',
    p: [
      'Your information may be stored or processed by our service providers or partners located outside your province or outside Canada, where it may be accessible to courts, law enforcement, and regulatory authorities of those jurisdictions.',
    ],
  },
  {
    h: 'Your rights',
    p: [
      'Subject to legal limitations, you may request access to and correction of the personal information we hold about you, and you may withdraw your consent. To exercise these rights, contact our Privacy Officer at privacy@vehicleapprovalcentre.com. You also have the right to complain to the Office of the Privacy Commissioner of Canada.',
    ],
  },
  {
    h: 'Cookies and analytics',
    p: [
      'We use cookies and similar technologies to operate our site, remember your progress, and understand how our service is used.',
    ],
  },
  {
    h: 'Age',
    p: [
      'Our service is intended for individuals who have reached the age of majority in their province. We do not knowingly collect personal information from minors.',
    ],
  },
  {
    h: 'Changes to this policy',
    p: [
      'We may update this Privacy Policy from time to time. The "last updated" date below reflects the most recent version.',
    ],
  },
  {
    h: 'Contact us',
    p: [
      'For privacy questions or requests, contact our Privacy Officer at privacy@vehicleapprovalcentre.com.',
    ],
  },
];

const TERMS: Section[] = [
  {
    h: 'Acceptance of these terms',
    p: [
      'By accessing apply.vehicleapprovalcentre.com or submitting an application, you agree to these Terms of Use. If you do not agree, please do not use the service.',
    ],
  },
  {
    h: 'What Vehicle Approval Centre is — and is not',
    p: [
      'Vehicle Approval Centre is a lead-generation and referral service that connects you with third-party automotive dealer and financing partners.',
      'Vehicle Approval Centre is NOT a lender, a dealer, or a broker. We do not make lending decisions, approve or provide financing, or sell vehicles. We do not guarantee that you will be approved for financing, or that you will be matched with any particular dealer, lender, or vehicle.',
    ],
  },
  {
    h: 'Eligibility',
    p: [
      'To use the service you must be at least the age of majority in your province (19 in Nova Scotia), a resident of Canada, and legally able to enter into a binding contract.',
    ],
  },
  {
    h: 'Your responsibilities',
    p: [
      'You agree to provide information that is accurate, complete, and current, and confirm that you are authorized to provide it. You are solely responsible for your dealings and communications with the dealer and financing partners we connect you with.',
    ],
  },
  {
    h: 'Consent to be contacted',
    p: [
      'By submitting an application, you consent to be contacted by Vehicle Approval Centre and its dealer and financing partners by phone, text message, and email, including by automated means, as described in the application and our Privacy Policy. You may withdraw consent or unsubscribe at any time.',
    ],
  },
  {
    h: 'Third-party partners',
    p: [
      'Dealers, lenders, and financing partners are independent third parties. Any application, financing, agreement, or vehicle purchase is solely between you and that third party. Vehicle Approval Centre is not responsible for, and does not endorse or guarantee, their acts, omissions, offers, products, or services.',
    ],
  },
  {
    h: 'No advice',
    p: [
      'Nothing on apply.vehicleapprovalcentre.com constitutes financial, credit, or legal advice. You should obtain independent advice before entering into any financing or purchase.',
    ],
  },
  {
    h: 'Intellectual property',
    p: [
      'The apply.vehicleapprovalcentre.com site and its content are owned by Vehicle Approval Centre or its licensors and may not be copied, reproduced, or used without our prior written permission.',
    ],
  },
  {
    h: 'Disclaimers',
    p: [
      'The service is provided on an "as is" and "as available" basis, without warranties of any kind, whether express or implied, to the fullest extent permitted by law.',
    ],
  },
  {
    h: 'Limitation of liability',
    p: [
      'To the maximum extent permitted by law, Vehicle Approval Centre will not be liable for any indirect, incidental, special, or consequential damages arising out of or relating to your use of the service or your dealings with any partner.',
    ],
  },
  {
    h: 'Indemnification',
    p: [
      'You agree to indemnify and hold Vehicle Approval Centre harmless from any claims, losses, or expenses arising from your use of the service or your breach of these Terms.',
    ],
  },
  {
    h: 'Governing law',
    p: [
      'These Terms are governed by the laws of the Province of Nova Scotia and the federal laws of Canada applicable therein, without regard to conflict-of-laws principles.',
    ],
  },
  {
    h: 'Changes to these terms',
    p: [
      'We may update these Terms from time to time. Your continued use of the service after changes take effect constitutes acceptance of the updated Terms.',
    ],
  },
  {
    h: 'Contact us',
    p: [
      'Questions about these Terms can be sent to support@vehicleapprovalcentre.com.',
    ],
  },
];

export default function DriveVacLegal({ doc }: { doc: 'privacy' | 'terms' }) {
  const isPrivacy = doc === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Use';
  const sections = isPrivacy ? PRIVACY : TERMS;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-5 py-10 md:py-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <Logo className="h-7 w-auto" />
            <span className="text-xl font-black text-brand-primary tracking-tight">Vehicle Approval Centre</span>
          </div>
          <Link to="/get-approved" className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-primary hover:text-brand-accent">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </div>

        <h1 className="text-3xl md:text-4xl font-black text-brand-primary tracking-tight mb-2">{title}</h1>
        <p className="text-xs text-gray-400 mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-7">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-bold text-brand-primary mb-2">{s.h}</h2>
              <div className="space-y-3">
                {s.p.map((para, i) => (
                  <p key={i} className="text-[15px] text-slate-600 leading-relaxed">{para}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 flex items-center justify-between">
          <Link to={isPrivacy ? '/dv-terms' : '/dv-privacy'} className="text-xs font-bold text-brand-accent hover:underline">
            {isPrivacy ? 'View Terms of Use →' : 'View Privacy Policy →'}
          </Link>
          <p className="text-[11px] text-gray-400">© {new Date().getFullYear()} Vehicle Approval Centre</p>
        </div>
      </div>
    </div>
  );
}
