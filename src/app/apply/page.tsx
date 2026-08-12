"use client";

import { useState } from "react";

/**
 * Applicant flow -- new business / renewal, phone OTP, legacy-claim, and
 * the application form. Screen sequencing and copy are ported from
 * reference/MuniServe_Applicant_Flow_Prototype.html per CLAUDE.md section
 * 8, kept as one client-side state machine (matching the prototype's own
 * structure) rather than separate routed pages, since the in-progress
 * wizard state is ephemeral and doesn't need to survive a page reload --
 * only the final submitted application does (that's /status/[reference]).
 *
 * Extends the prototype in two ways CLAUDE.md's written description
 * (section 5) calls for but the demo doesn't show:
 *   1. A "sign in with your phone instead" link on the license-number
 *      screen, for a returning owner's second-and-later renewal ("every
 *      renewal after this first one works purely on phone-number OTP, no
 *      License Number needed").
 *   2. A business-picker step when a returning owner chooses to renew and
 *      turns out to have more than one business on file.
 */

type Screen =
  | "landing"
  | "renewal_license"
  | "renewal_confirm"
  | "phone"
  | "otp"
  | "name"
  | "owner_match"
  | "business_picker"
  | "form"
  | "submitted";

type LegacyMatch = {
  id: string;
  businessName: string;
  ownerNameMasked: string;
  barangay: string | null;
  natureOfBusiness: string | null;
  grossSales: number | null;
};

type MyBusiness = {
  id: string;
  businessName: string;
  barangay: string | null;
  natureOfBusiness: string | null;
  grossSales: number | null;
};

type LbtCategory = { value: string; label: string };

const DOCUMENT_TYPES = [
  "Barangay business clearance",
  "CEDULA",
  "Valid government ID",
  "Proof of business address",
  "DTI / SEC / CDA registration",
];

function conditionalFieldsFor(natureOfBusiness: string) {
  const n = natureOfBusiness.toLowerCase();
  const fields: { key: "billiardTableCount" | "lodgerCount" | "floorAreaSqm"; label: string }[] = [];
  if (n.includes("billiard")) fields.push({ key: "billiardTableCount", label: "Number of billiard tables" });
  if (n.includes("lodg") || n.includes("inn") || n.includes("pension") || n.includes("boarding") || n.includes("dormitory"))
    fields.push({ key: "lodgerCount", label: "Number of lodgers / rooms" });
  if (n.includes("warehouse") || n.includes("bodega") || n.includes("storage"))
    fields.push({ key: "floorAreaSqm", label: "Floor area (square meters)" });
  return fields;
}

export default function ApplyPage() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [path, setPath] = useState<"new" | "renewal" | null>(null);
  const [phoneSigninMode, setPhoneSigninMode] = useState(false);

  const [licenseInput, setLicenseInput] = useState("");
  const [matchedLegacy, setMatchedLegacy] = useState<LegacyMatch | null>(null);
  const [noMatch, setNoMatch] = useState(false);

  const [phone, setPhone] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [matched, setMatched] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [businessCount, setBusinessCount] = useState(0);
  const [myBusinesses, setMyBusinesses] = useState<MyBusiness[] | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);

  const [lbtCategories, setLbtCategories] = useState<LbtCategory[]>([]);
  const [form, setForm] = useState({
    businessName: "",
    barangay: "",
    address: "",
    natureOfBusiness: "",
    lbtCategory: "",
    basisAmount: "",
    billiardTableCount: "",
    lodgerCount: "",
    floorAreaSqm: "",
  });
  const [documentIds, setDocumentIds] = useState<Record<string, string>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  const [submittedReference, setSubmittedReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startOver() {
    setScreen("landing");
    setPath(null);
    setPhoneSigninMode(false);
    setLicenseInput("");
    setMatchedLegacy(null);
    setNoMatch(false);
    setPhone("");
    setOtpInput("");
    setOtpSent(false);
    setMatched(false);
    setNeedsName(false);
    setNameInput("");
    setBusinessCount(0);
    setMyBusinesses(null);
    setSelectedBusinessId(null);
    setForm({
      businessName: "", barangay: "", address: "", natureOfBusiness: "", lbtCategory: "",
      basisAmount: "", billiardTableCount: "", lodgerCount: "", floorAreaSqm: "",
    });
    setDocumentIds({});
    setSubmittedReference(null);
    setError(null);
  }

  async function lookupLicense() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/lookup-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseNumber: licenseInput.trim() }),
      });
      const data = await res.json();
      if (data.found) {
        setMatchedLegacy(data.business);
        setNoMatch(false);
      } else {
        setMatchedLegacy(null);
        setNoMatch(true);
      }
      setScreen("renewal_confirm");
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "too_soon" ? "Please wait a bit before requesting another code." : "Could not send a code to that number. Check it and try again.");
        return;
      }
      setOtpSent(true);
      setScreen("otp");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLbtCategories() {
    const res = await fetch("/api/applicant/lbt-categories");
    const data = await res.json();
    setLbtCategories(data.categories ?? []);
  }

  async function fetchMyBusinesses(): Promise<MyBusiness[]> {
    const res = await fetch("/api/applicant/my-businesses");
    const data = await res.json();
    const businesses: MyBusiness[] = data.businesses ?? [];
    setMyBusinesses(businesses);
    return businesses;
  }

  async function verifyOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code: otpInput.trim(),
          legacyBusinessId: path === "renewal" && matchedLegacy ? matchedLegacy.id : undefined,
        }),
      });
      if (!res.ok) {
        setError("That code didn't work — check it and try again, or request a new one.");
        return;
      }
      const data = await res.json();
      setMatched(data.matched);
      setNeedsName(data.needsName);
      setBusinessCount(data.businessCount);

      await fetchLbtCategories();

      if (path === "renewal" && matchedLegacy) {
        // Legacy claim just completed -- go straight to the form for that business.
        setSelectedBusinessId(matchedLegacy.id);
        setForm((f) => ({
          ...f,
          businessName: matchedLegacy.businessName,
          barangay: matchedLegacy.barangay ?? "",
          natureOfBusiness: matchedLegacy.natureOfBusiness ?? "",
          basisAmount: matchedLegacy.grossSales != null ? String(matchedLegacy.grossSales) : "",
        }));
        setScreen("form");
      } else if (path === "renewal" && phoneSigninMode) {
        // Returning owner signing in by phone for a later renewal.
        if (!data.matched) {
          setError("We don't have an account under this number yet. If you have an existing business, please use your License Number instead.");
          setScreen("renewal_license");
          return;
        }
        const businesses = await fetchMyBusinesses();
        if (businesses.length === 1) {
          const b = businesses[0];
          setSelectedBusinessId(b.id);
          setForm((f) => ({
            ...f, businessName: b.businessName, barangay: b.barangay ?? "",
            natureOfBusiness: b.natureOfBusiness ?? "", basisAmount: b.grossSales != null ? String(b.grossSales) : "",
          }));
          setScreen("form");
        } else {
          setScreen("business_picker");
        }
      } else if (data.needsName) {
        setScreen("name");
      } else if (data.matched) {
        setScreen("owner_match");
      } else {
        setScreen("form");
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitName() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (!res.ok) {
        setError("Please enter your full name.");
        return;
      }
      setScreen("form");
    } finally {
      setLoading(false);
    }
  }

  function pickBusiness(b: MyBusiness) {
    setSelectedBusinessId(b.id);
    setForm((f) => ({
      ...f, businessName: b.businessName, barangay: b.barangay ?? "",
      natureOfBusiness: b.natureOfBusiness ?? "", basisAmount: b.grossSales != null ? String(b.grossSales) : "",
    }));
    setScreen("form");
  }

  async function uploadDocument(documentType: string, file: File) {
    setUploadingDoc(documentType);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", documentType);
      const res = await fetch("/api/applicant/upload-document", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "file_too_large" ? "That file is too large (10MB max)." : "Could not upload that file — try a PDF or image under 10MB.");
        return;
      }
      const data = await res.json();
      setDocumentIds((prev) => ({ ...prev, [documentType]: data.documentId }));
    } finally {
      setUploadingDoc(null);
    }
  }

  async function submitApplication() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationType: path,
          businessId: selectedBusinessId ?? undefined,
          businessName: form.businessName,
          barangay: form.barangay || undefined,
          address: form.address || undefined,
          natureOfBusiness: form.natureOfBusiness,
          lbtCategory: form.lbtCategory,
          basisAmount: Number(form.basisAmount) || 0,
          billiardTableCount: form.billiardTableCount ? Number(form.billiardTableCount) : undefined,
          lodgerCount: form.lodgerCount ? Number(form.lodgerCount) : undefined,
          floorAreaSqm: form.floorAreaSqm ? Number(form.floorAreaSqm) : undefined,
          documentIds: Object.values(documentIds),
        }),
      });
      if (!res.ok) {
        setError("Something went wrong submitting your application. Please try again.");
        return;
      }
      const data = await res.json();
      setSubmittedReference(data.referenceNumber);
      setScreen("submitted");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb", fontFamily: "-apple-system, 'Segoe UI', Arial, sans-serif", color: "#1a1a2e" }}>
      {screen !== "landing" && screen !== "submitted" && (
        <button onClick={startOver} style={backBtnStyle}>Start over</button>
      )}
      {error && (
        <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      {screen === "landing" && (
        <>
          <Head title="MuniServe" sub="San Miguel, Bulacan · Business permit application" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <OptCard title="New business" desc="First time applying for a permit with this business." onClick={() => { setPath("new"); setPhoneSigninMode(false); setScreen("phone"); }} />
            <OptCard title="Renew existing permit" desc="Already have a business registered with the municipality." onClick={() => { setPath("renewal"); setPhoneSigninMode(false); setScreen("renewal_license"); }} />
          </div>
        </>
      )}

      {screen === "renewal_license" && (
        <>
          <Head title="Find your business" sub="Enter the License Number printed on your current permit or last official receipt." />
          <Field label="License number">
            <input value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)} placeholder="e.g. 7094956" style={inputStyle} />
          </Field>
          <button onClick={lookupLicense} disabled={loading || !licenseInput.trim()} style={actBtnStyle}>Continue</button>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 16 }}>
            Already claimed your business before?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setPhoneSigninMode(true); setScreen("phone"); }} style={{ color: "#0C447C" }}>
              Sign in with your phone instead
            </a>.
          </p>
        </>
      )}

      {screen === "renewal_confirm" && (
        noMatch ? (
          <>
            <Head title="No match found" sub="We could not find a business with that License Number. Please check the number or visit the BPLO counter for assistance." />
            <button onClick={() => setScreen("renewal_license")} style={actBtnStyle}>Try again</button>
          </>
        ) : matchedLegacy && (
          <>
            <Head title="Is this your business?" sub="We found a record under this License Number. Confirm before continuing." />
            <div style={cardStyle}>
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{matchedLegacy.businessName}</p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>
                Owner on file: {matchedLegacy.ownerNameMasked} · {matchedLegacy.barangay} · {matchedLegacy.natureOfBusiness}
              </p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setScreen("phone")} style={actBtnStyle}>Yes, this is my business</button>
              <button onClick={() => { setMatchedLegacy(null); setScreen("renewal_license"); }} style={actBtnStyle}>Not me</button>
            </div>
          </>
        )
      )}

      {screen === "phone" && (
        <>
          <Head title="Verify your mobile number" sub="We will send a one-time code by SMS. No password to remember — you will use this number every time you check your application." />
          <Field label="Mobile number">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" style={inputStyle} />
          </Field>
          <button onClick={sendOtp} disabled={loading || !phone.trim()} style={actBtnStyle}>{loading ? "Sending…" : "Send code"}</button>
        </>
      )}

      {screen === "otp" && (
        <>
          <Head title="Enter the code" sub={`We sent a 6-digit code to ${phone}.`} />
          <Field label="Verification code">
            <input value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit code" style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={verifyOtp} disabled={loading || otpInput.trim().length !== 6} style={actBtnStyle}>Verify</button>
            <button onClick={sendOtp} disabled={loading} style={actBtnStyle}>Resend code</button>
          </div>
          {otpSent && <p style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>Code sent via SMS.</p>}
        </>
      )}

      {screen === "name" && (
        <>
          <Head title="What's your name?" sub="This is how BPLO and department staff will identify you as the owner." />
          <Field label="Full name">
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Juan Dela Cruz" style={inputStyle} />
          </Field>
          <button onClick={submitName} disabled={loading || nameInput.trim().length < 2} style={actBtnStyle}>Continue</button>
        </>
      )}

      {screen === "owner_match" && (
        <>
          <Head title="We found an account" sub="A profile already exists for this mobile number." />
          <div style={cardStyle}>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Welcome back</p>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{businessCount} business{businessCount === 1 ? "" : "es"} currently on file</p>
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>This new business will be added to your existing profile, no separate account needed.</p>
          <button onClick={() => setScreen("form")} style={actBtnStyle}>Continue</button>
        </>
      )}

      {screen === "business_picker" && myBusinesses && (
        <>
          <Head title="Which business are you renewing?" sub="Select one to continue." />
          <div style={{ border: "0.5px solid #e5e7eb", borderRadius: 8 }}>
            {myBusinesses.map((b) => (
              <div key={b.id} onClick={() => pickBusiness(b)} style={rowStyle}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{b.businessName}</p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{b.barangay} · {b.natureOfBusiness}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {screen === "form" && (
        <>
          <Head title="Business permit application" sub={`${path === "renewal" ? "Renewal" : "New application"} · San Miguel, Bulacan`} />
          {path === "renewal" && (
            <div style={{ ...cardStyle, background: "#f4f6fb", border: "none" }}>
              <p style={{ fontSize: 12, color: "#6b7280" }}>Pre-filled from your existing record, update anything that has changed.</p>
            </div>
          )}
          <Field label="Business name">
            <input value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} placeholder="Business name" style={inputStyle} />
          </Field>
          <Field label="Barangay">
            <input value={form.barangay} onChange={(e) => setForm((f) => ({ ...f, barangay: e.target.value }))} placeholder="Barangay" style={inputStyle} />
          </Field>
          <Field label="Nature of business">
            <input value={form.natureOfBusiness} onChange={(e) => setForm((f) => ({ ...f, natureOfBusiness: e.target.value }))} placeholder="e.g. Retailer, Food and beverage establishment" style={inputStyle} />
          </Field>
          <Field label="LBT category">
            <select value={form.lbtCategory} onChange={(e) => setForm((f) => ({ ...f, lbtCategory: e.target.value }))} style={inputStyle}>
              <option value="">Select one</option>
              {lbtCategories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          {conditionalFieldsFor(form.natureOfBusiness).map((c) => (
            <Field key={c.key} label={c.label}>
              <input
                value={form[c.key]}
                onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                placeholder="Enter a number"
                style={inputStyle}
              />
            </Field>
          ))}
          <Field label={path === "new" ? "Capital investment (₱)" : "Gross sales, preceding year (₱)"}>
            <input value={form.basisAmount} onChange={(e) => setForm((f) => ({ ...f, basisAmount: e.target.value }))} placeholder="0" style={inputStyle} />
          </Field>

          <p style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", margin: "12px 0 6px" }}>Documents to upload</p>
          {DOCUMENT_TYPES.map((d) => (
            <div key={d} style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", marginBottom: 6 }}>
              <span style={{ fontSize: 12 }}>{d}{documentIds[d] ? " ✓" : ""}</span>
              <label style={{ ...actBtnStyle, display: "inline-block" }}>
                {uploadingDoc === d ? "Uploading…" : documentIds[d] ? "Replace" : "Choose file"}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocument(d, f); }}
                />
              </label>
            </div>
          ))}

          <button
            onClick={submitApplication}
            disabled={loading || !form.businessName || !form.natureOfBusiness || !form.lbtCategory}
            style={{ ...actBtnStyle, marginTop: 8 }}
          >
            {loading ? "Submitting…" : "Submit application"}
          </button>
        </>
      )}

      {screen === "submitted" && submittedReference && (
        <>
          <Head title="Application submitted" sub={`Reference number ${submittedReference}`} />
          <div style={cardStyle}>
            <p style={{ fontSize: 13 }}>BPLO will review your submitted documents first. You will get an SMS the moment there is an update, no need to keep checking.</p>
          </div>
          <a href={`/status/${submittedReference}`} style={{ ...actBtnStyle, display: "inline-block", textDecoration: "none" }}>View application status</a>
        </>
      )}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: 500, fontSize: 16, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function OptCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "1rem", cursor: "pointer", flex: 1, minWidth: 200 }}>
      <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#6b7280" }}>{desc}</p>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer", marginBottom: 16 };
const actBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer" };
const inputStyle: React.CSSProperties = { width: "100%", height: 36, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff", color: "#1a1a2e" };
const cardStyle: React.CSSProperties = { border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: "1rem" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "0.5px solid #e5e7eb", cursor: "pointer" };
