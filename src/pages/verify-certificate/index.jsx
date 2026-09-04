import React from 'react';
import { useParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import Icon from '../../components/AppIcon';
import CertificateVerifier from '../../components/CertificateVerifier';

/**
 * The certificate verification desk — sacco portals only (see Routes.jsx).
 *
 * One place to answer "is this piece of paper real". Reachable as
 * /verify-certificate, or with the serial in the path
 * (/verify-certificate/ARA-SHR-2026-000412-7QK3) so a serial can be sent as a
 * link.
 *
 * The lookup is not scoped to the reader's own society, on purpose: the person
 * holding a certificate is usually not from the one that issued it. See
 * system_certificate_verify() for what that does and does not disclose.
 *
 * Any serial the platform has minted resolves here, including the ARA-STL
 * settlement serials that company tenants issue — those are just not advertised
 * below, because nobody who can reach this page issues one.
 */

const KINDS = [
  { icon: 'Award',   title: 'Share certificates',     body: 'Issued by the society whenever a member’s holding changes. Serials begin ARA-SHR.' },
  { icon: 'PenTool', title: 'Signature certificates', body: 'The certificate page appended to every sealed e-signature document. Serials begin ARA-ESG.' },
];

const VerifyCertificatePage = () => {
  const { serial } = useParams();

  return (
    <MainLayout>
      <div className="space-y-6 max-w-3xl">

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0c2037,#1A56DB)' }}>
            <Icon name="ShieldCheck" size={24} color="white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Verify a certificate</h1>
            <p className="text-sm text-muted-foreground">
              Confirm that a certificate serial was really issued by this system, and that its record is unaltered.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground mb-4">
            Type the serial printed on the certificate. Spacing, dashes and capitals do not matter.
          </p>
          <CertificateVerifier initialSerial={serial || ''} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {KINDS.map(({ icon, title, body }) => (
            <div key={title} className="bg-card border border-border rounded-xl p-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <Icon name={icon} size={16} color="var(--color-primary)" />
              </div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-1">{body}</p>
            </div>
          ))}
        </div>

      </div>
    </MainLayout>
  );
};

export default VerifyCertificatePage;
