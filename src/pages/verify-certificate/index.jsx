import React from 'react';
import { useParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import Icon from '../../components/AppIcon';
import CertificateVerifier from '../../components/CertificateVerifier';

/**
 * The certificate verification desk.
 *
 * One place to answer "is this piece of paper real", for every kind of
 * certificate the platform issues. Reachable as /verify-certificate, or with the
 * serial in the path (/verify-certificate/ARA-SHR-2026-000412-7QK3) so a serial
 * can be sent as a link.
 *
 * Not scoped to the reader's own organisation, on purpose: the person holding a
 * certificate is usually not from the organisation that issued it. See
 * system_certificate_verify() for what that does and does not disclose.
 */

const KINDS = [
  { icon: 'Award',      title: 'Share certificates',      body: 'Issued by a society whenever a member’s holding changes. Serials begin ARA-SHR.' },
  { icon: 'FileCheck',  title: 'Settlement certificates', body: 'Full settlement and ownership transfer of a financed asset. Serials begin ARA-STL.' },
  { icon: 'PenTool',    title: 'Signature certificates',  body: 'The certificate page appended to every sealed e-signature document. Serials begin ARA-ESG.' },
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

        <div className="grid gap-4 sm:grid-cols-3">
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

        <div className="bg-muted/30 border border-border rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-2">What a result means</h2>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li><strong className="text-foreground">Genuine and current</strong> — the serial is on the register and the record still matches the seal taken when it was issued.</li>
            <li><strong className="text-foreground">Superseded</strong> — genuine, but a later certificate has replaced it. A share certificate is superseded every time the holding changes.</li>
            <li><strong className="text-foreground">Revoked</strong> — the issuer withdrew it. The reason they gave is shown.</li>
            <li><strong className="text-foreground">No certificate with that serial</strong> — nothing has ever been issued under that number on this platform.</li>
            <li><strong className="text-foreground">Record does not match its own seal</strong> — the serial exists but the stored record has been altered since issue. Treat the document as unverified and report it.</li>
          </ul>
          <p className="text-[11px] text-muted-foreground mt-3">
            Every check is recorded against the certificate, with who ran it and when.
          </p>
        </div>

      </div>
    </MainLayout>
  );
};

export default VerifyCertificatePage;
