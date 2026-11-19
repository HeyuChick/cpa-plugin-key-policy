import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createKey } from "../api/keys";
import KeyForm, { type KeyFormRouteState } from "../components/KeyForm";
import PlainKeyModal from "../components/PlainKeyModal";
import { MobileFormHeader, MobileTabBar } from "./KeyList";
import { useT } from "../i18n";

export default function KeyNew() {
  const nav = useNavigate();
  const loc = useLocation();
  const t = useT();
  const [plain, setPlain] = useState<string | null>(null);

  const title = t("new.title");

  const draft = (loc.state as KeyFormRouteState | null)?.draftKey;

  return (
    <div className="form-page">
      <div className="fp-head mobile-hidden">
        <h1>{title}</h1>
      </div>
      <MobileFormHeader title={title} backTo="/keys" />
      <KeyForm
        initial={draft}
        pickPath="/keys/new/models"
        submitLabel={t("new.create")}
        onCancel={() => nav("/keys")}
        onSubmit={async (v) => {
          const r = await createKey({
            id: v.id,
            name: v.name || undefined,
            enabled: v.enabled,
            rpm: v.rpm,
            models: v.models,
            daily_limit_usd: v.daily_limit_usd,
            weekly_limit_usd: v.weekly_limit_usd,
            allow_models_endpoint: v.allow_models_endpoint,
          });
          setPlain(r.plain_key);
        }}
      />
      <p className="fp-note mobile-hidden">{t("login.memoryNote")}</p>
      {plain && (
        <PlainKeyModal
          plainKey={plain}
          title={t("plainModal.created")}
          onClose={() => {
            setPlain(null);
            nav("/keys");
          }}
        />
      )}
      <MobileTabBar active="new" />
    </div>
  );
}
