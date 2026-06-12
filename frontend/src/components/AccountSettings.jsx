import { useState } from "react";
import { API } from "../api.js";
import { useLang } from "../i18n.js";
import { useToast } from "./ui/Toast.jsx";

const PW_SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;
const PW_UPPER_RE   = /[A-Z]/;
const isPwValid = pw => pw.length >= 8 && PW_UPPER_RE.test(pw) && PW_SPECIAL_RE.test(pw);

const fieldLabel = { fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6, display: "block" };

function PasswordChecklist({ password }) {
  const { t } = useLang();
  const checks = {
    length:  password.length >= 8,
    upper:   PW_UPPER_RE.test(password),
    special: PW_SPECIAL_RE.test(password),
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", marginTop: 8 }}>
      {[
        [checks.length,  t("auth.pwReq.length")],
        [checks.upper,   t("auth.pwReq.upper")],
        [checks.special, t("auth.pwReq.special")],
      ].map(([ok, label], i) => (
        <span key={i} style={{ fontSize: 12, fontWeight: 600, color: ok ? "var(--green)" : "var(--text3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {ok ? "✓" : "○"} {label}
        </span>
      ))}
    </div>
  );
}

export default function AccountSettings({ user, onUpdateUser, onLogout, onGoHome }) {
  const { t } = useLang();
  const addToast = useToast();

  const [name, setName] = useState(user?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const deleteWord = t("account.deleteConfirmWord");

  const saveProfile = async () => {
    if (!name.trim()) return;
    setSavingProfile(true);
    const res = await API.updateProfile({ name: name.trim() });
    setSavingProfile(false);
    if (res?.success) {
      onUpdateUser?.(res.user);
      addToast(t("account.profileUpdated"));
    } else {
      addToast(res?.error || t("account.errorGeneric"), "error");
    }
  };

  const changeEmail = async () => {
    if (!newEmail.trim() || !emailPw) return;
    setSavingEmail(true);
    const res = await API.updateProfile({ email: newEmail.trim(), currentPassword: emailPw });
    setSavingEmail(false);
    if (res?.success) {
      onUpdateUser?.(res.user);
      setNewEmail(""); setEmailPw("");
      addToast(t("account.emailUpdated"));
    } else {
      addToast(res?.error || t("account.errorGeneric"), "error");
    }
  };

  const changePassword = async () => {
    if (!curPw || !newPw) return;
    if (!isPwValid(newPw)) { addToast(t("auth.pwTooWeak"), "error"); return; }
    if (newPw !== confirmPw) { addToast(t("account.pwMismatch"), "error"); return; }
    setSavingPw(true);
    const res = await API.updatePassword({ currentPassword: curPw, newPassword: newPw });
    setSavingPw(false);
    if (res?.success) {
      setCurPw(""); setNewPw(""); setConfirmPw("");
      addToast(t("account.passwordUpdated"));
    } else {
      addToast(res?.error || t("account.errorGeneric"), "error");
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const res = await API.deleteAccount();
    setDeleting(false);
    if (res?.success) {
      onLogout?.();
    } else {
      addToast(res?.error || t("account.errorGeneric"), "error");
    }
  };

  return (
    <div className="fade page-pad" style={{ padding: "28px 0", maxWidth: 560 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
        <button onClick={onGoHome} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 12, fontWeight: 500, padding: 0 }}>{t("nav.home")}</button>
        <span>›</span><span style={{ color: "var(--text)", fontWeight: 600 }}>{t("account.title")}</span>
      </div>

      <h1 className="page-title">{t("account.title")}</h1>

      {/* Profile */}
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <p className="section-label">{t("account.profileCard")}</p>
        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel}>{t("account.nameLabel")}</label>
          <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={fieldLabel}>{t("account.emailLabel")}</label>
          <input className="input" type="email" value={user?.email || ""} disabled style={{ opacity: .6, cursor: "not-allowed" }} />
        </div>
        <button className="btn btn-blue" disabled={savingProfile || !name.trim()} style={{ opacity: savingProfile || !name.trim() ? .6 : 1, cursor: savingProfile || !name.trim() ? "not-allowed" : "pointer" }} onClick={saveProfile}>
          {savingProfile ? t("account.saving") : t("account.saveChanges")}
        </button>
      </div>

      {/* Security */}
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <p className="section-label">{t("account.securityCard")}</p>

        {/* Change email */}
        <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid var(--border2)" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("account.changeEmailTitle")}</p>
          <div style={{ marginBottom: 14 }}>
            <label style={fieldLabel}>{t("account.newEmailLabel")}</label>
            <input className="input" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder={user?.email || ""} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabel}>{t("account.currentPasswordLabel")}</label>
            <input className="input" type="password" value={emailPw} onChange={e => setEmailPw(e.target.value)} />
          </div>
          <button className="btn btn-ghost" disabled={savingEmail || !newEmail.trim() || !emailPw} style={{ opacity: savingEmail || !newEmail.trim() || !emailPw ? .6 : 1, cursor: savingEmail || !newEmail.trim() || !emailPw ? "not-allowed" : "pointer" }} onClick={changeEmail}>
            {savingEmail ? t("account.saving") : t("account.changeEmailBtn")}
          </button>
        </div>

        {/* Change password */}
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t("account.changePasswordTitle")}</p>
          <div style={{ marginBottom: 14 }}>
            <label style={fieldLabel}>{t("account.currentPasswordLabel")}</label>
            <input className="input" type="password" value={curPw} onChange={e => setCurPw(e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={fieldLabel}>{t("account.newPasswordLabel")}</label>
            <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
            <PasswordChecklist password={newPw} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={fieldLabel}>{t("account.confirmPasswordLabel")}</label>
            <input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
          </div>
          <button className="btn btn-ghost" disabled={savingPw || !curPw || !newPw || !confirmPw} style={{ opacity: savingPw || !curPw || !newPw || !confirmPw ? .6 : 1, cursor: savingPw || !curPw || !newPw || !confirmPw ? "not-allowed" : "pointer" }} onClick={changePassword}>
            {savingPw ? t("account.saving") : t("account.changePasswordBtn")}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card" style={{ padding: 24, border: "1px solid var(--red-light)" }}>
        <p className="section-label" style={{ color: "var(--red)" }}>{t("account.dangerCard")}</p>
        <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>{t("account.dangerDesc")}</p>
        <button className="btn" style={{ background: "var(--red-light)", color: "var(--red)" }} onClick={() => setShowDelete(true)}>
          {t("account.deleteAccountBtn")}
        </button>
      </div>

      {/* Delete confirmation modal */}
      {showDelete && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowDelete(false)}>
          <div className="card fade" style={{ width: 400, maxWidth: "92vw", padding: 28, marginTop: 0 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--red)" }}>{t("account.deleteModalTitle")}</h3>
            <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>
              {t("account.deleteModalDesc", { word: deleteWord })}
            </p>
            <input className="input" type="text" value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={t("account.deleteConfirmPlaceholder")} style={{ marginBottom: 20 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowDelete(false); setDeleteText(""); }}>{t("account.cancel")}</button>
              <button className="btn" style={{ flex: 1, background: "var(--red)", color: "#fff", opacity: deleteText !== deleteWord || deleting ? .6 : 1, cursor: deleteText !== deleteWord || deleting ? "not-allowed" : "pointer" }} disabled={deleteText !== deleteWord || deleting} onClick={deleteAccount}>
                {deleting ? t("account.saving") : t("account.deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
