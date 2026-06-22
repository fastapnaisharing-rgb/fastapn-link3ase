import React from "react";

function PlaceholderPage({ title }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>💹</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>อยู่ระหว่างการพัฒนา</div>
    </div>
  );
}

export default function VatController({ activeSubTab = 'incomplete-report', onSubTabChange }) {
  return <PlaceholderPage title={
    activeSubTab === 'incomplete-report'  ? 'Incomplete Report'  :
    activeSubTab === 'amagno-reconcile'   ? 'Amagno Reconcile'   :
    activeSubTab === 'popvat-report'      ? 'Popvat Report'      :
    activeSubTab === 'simple-input-report'? 'Simple Input Report' :
    'VAT Controller'
  } />;
}