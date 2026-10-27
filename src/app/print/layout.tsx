export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-200 py-8 print:bg-white print:py-0">{children}</div>;
}
