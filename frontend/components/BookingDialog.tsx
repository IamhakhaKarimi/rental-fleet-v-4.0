"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { formatEur } from "@/lib/money";
import { addDaysISO, daysBetweenISO, todayISO } from "@/lib/dates";
import { isLicenseError, licenseCapNote, licenseMessage, useLicenseLimits } from "@/lib/license";
import { DateField } from "@/components/DateField";
import { TimeSelect24 } from "@/components/TimeSelect24";
import { InvoicePreview, useBusinessBrand } from "@/components/InvoicePreview";
import { StepSidebar } from "@/components/StepSidebar";
import type { LanguagesInfo } from "@/lib/types";

type StepId = "period" | "vehicle" | "client" | "review";

interface FreeCar {
  vehicle_id: string;
  make_model: string;
  license_plate: string;
  base_daily_rate: number;
}

/** +/- stepper wrapped around a numeric input — same control for rate, deposit
 *  and days, so the three numeric fields read and behave identically. */
function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  /** Upper bound (the days field uses it for the licensed-period cap). */
  max?: number;
  ariaLabel?: string;
}) {
  const clamp = (n: number) => (max === undefined ? Math.max(min, n) : Math.min(max, Math.max(min, n)));
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="btn !p-1.5 shrink-0"
        onClick={() => onChange(clamp(value - step))}
        aria-label={`−${step}`}
        title={`−${step}`}
      >
        <span className="msr text-[15px]">remove</span>
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(clamp(+e.target.value))}
        className="flex-1 min-w-0 text-center !py-1.5"
      />
      <button
        type="button"
        className="btn !p-1.5 shrink-0"
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + step))}
        aria-label={`+${step}`}
        title={`+${step}`}
      >
        <span className="msr text-[15px]">add</span>
      </button>
    </div>
  );
}

/**
 * Quick Rental Registration — a step sidebar (period → vehicle → client →
 * review) on the left of the form, one step's fields shown at a time, and a
 * live invoice preview down the right edge (what the client walks away with)
 * that stays visible across every step and drops away below `lg`. Navigation
 * between steps is free — every row in the sidebar is clickable at any time —
 * the checkmarks are just a progress cue, not a gate.
 *
 * `preselectVehicleId` pre-picks a car (used by the dashboard "Rent" buttons).
 */
export function BookingDialog({
  onClose,
  onCreated,
  preselectVehicleId,
}: {
  onClose: () => void;
  onCreated: () => void;
  preselectVehicleId?: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const biz = useBusinessBrand();
  const license = useLicenseLimits();

  const [startDate, setStartDate] = useState(todayISO());
  const [allowPast, setAllowPast] = useState(false);
  const [startTime, setStartTime] = useState("10:00");
  const [days, setDays] = useState(3);
  const [returnTime, setReturnTime] = useState("10:00");
  const [cars, setCars] = useState<FreeCar[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idp, setIdp] = useState("");
  const [rate, setRate] = useState(30);
  const [deposit, setDeposit] = useState(0);
  const [lang, setLang] = useState("tr");
  const [langs, setLangs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activeStep, setActiveStep] = useState<StepId>("period");

  useEffect(() => {
    apiGet<LanguagesInfo>("/api/i18n/languages").then((d) => setLangs(d.languages)).catch(() => {});
  }, []);

  // ── License cap ──────────────────────────────────────────────────────────
  // The return date is *derived* from `days`, so the cap has to bite on the day
  // count too — otherwise a licensed start date plus 400 days walks straight
  // into an unlicensed year, which is exactly what the server now refuses.
  const licenseMax = license?.max_date;

  // Estimated return date is derived from start date + days; editing it feeds
  // back into `days` so the two inputs stay reciprocal. `days` remains the
  // single source of truth sent to the API — no payload/database change.
  const returnDate = useMemo(() => addDaysISO(startDate, days), [startDate, days]);
  const onReturnDateChange = (iso: string) => {
    if (!iso) return;
    setDays(clampDays(daysBetweenISO(startDate, iso)));
  };

  const maxDays = useMemo(
    () => (licenseMax && startDate ? Math.max(1, daysBetweenISO(startDate, licenseMax)) : undefined),
    [licenseMax, startDate]
  );
  function clampDays(n: number): number {
    const atLeastOne = Math.max(1, n);
    return maxDays ? Math.min(atLeastOne, maxDays) : atLeastOne;
  }
  /** The window reaches past the licensed year — the server would refuse it. */
  const overLicense = !!licenseMax && returnDate > licenseMax;

  useEffect(() => {
    // Don't ask the server for cars in a window it is licensed to refuse — the
    // 403 would land in the catch below and read as "no cars free" instead of
    // "your license doesn't reach that far".
    if (overLicense) {
      setCars([]);
      return;
    }
    apiPost<{ cars: FreeCar[] }>("/api/rentals/available-cars", {
      start_date: startDate,
      start_time: startTime,
      days,
      return_time: returnTime,
    })
      .then((d) => {
        setCars(d.cars);
        setVehicleId((cur) => {
          if (preselectVehicleId && d.cars.some((c) => c.vehicle_id === preselectVehicleId)) return preselectVehicleId;
          if (d.cars.some((c) => c.vehicle_id === cur)) return cur;
          return d.cars[0]?.vehicle_id || "";
        });
      })
      .catch(() => {});
  }, [startDate, startTime, days, returnTime, preselectVehicleId, overLicense]);

  // Pull an over-long booking back inside the licence the moment the cap loads
  // or the start date moves, so `days` can never carry a stale illegal value
  // into submit().
  useEffect(() => {
    if (maxDays !== undefined) setDays((d) => Math.min(Math.max(1, d), maxDays));
  }, [maxDays]);

  const car = cars.find((c) => c.vehicle_id === vehicleId);
  useEffect(() => {
    if (car) setRate(Math.max(0, Math.round(car.base_daily_rate / 100)));
  }, [vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => days * rate * 100, [days, rate]);

  const periodDone = !overLicense;
  const vehicleDone = !!vehicleId && rate > 0;
  const clientDone = !!name.trim() && !!phone.trim();
  const steps = [
    { id: "period" as StepId, label: tf("rental_period", "Rental period"), icon: "calendar_month", complete: periodDone },
    { id: "vehicle" as StepId, label: tf("deal_terms", "Vehicle & pricing"), icon: "directions_car", complete: vehicleDone },
    { id: "client" as StepId, label: tf("client_info", "Client Information"), icon: "person", complete: clientDone },
    { id: "review" as StepId, label: tf("review_step", "Review"), icon: "fact_check", complete: periodDone && vehicleDone && clientDone },
  ];
  const stepIndex = steps.findIndex((s) => s.id === activeStep);
  const goNext = () => setActiveStep(steps[Math.min(stepIndex + 1, steps.length - 1)].id);
  const goBack = () => setActiveStep(steps[Math.max(stepIndex - 1, 0)].id);

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setErr(t("register_need_fields"));
      return;
    }
    if (overLicense) {
      setErr(licenseMessage(t, license));
      return;
    }
    if (!vehicleId) {
      setErr(t("no_cars"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/rentals", {
        vehicle_id: vehicleId,
        make_model: car?.make_model || "",
        client_name: name,
        phone,
        id_passport: idp,
        start_date: startDate,
        start_time: startTime,
        days,
        return_time: returnTime,
        daily_rate_euros: rate,
        deposit_euros: deposit,
        invoice_lang: lang,
      });
      toast.success(tf("register_ok", "Reservation created."));
      onCreated();
      onClose();
    } catch (e: any) {
      // The server owns the licence decision; if it refused, say so in words
      // rather than showing the raw key.
      setErr(isLicenseError(e) ? licenseMessage(t, license) : t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  const lbl = "text-[11px] font-medium text-muted block mb-1";
  const groupTitle = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted";
  // Date over time, one under the other: the day is the decision, the hour is a
  // detail of it, and stacking them says so — as well as halving the width the
  // period band needs. Fixed height so the four groups' labels stay aligned.
  // `min-h` rather than a hard `h` below lg: the mobile layer sets
  // `.btn { white-space: normal }`, so a wrapped DateField/TimeSelect label
  // needs room to grow instead of being clipped by a fixed 70px.
  const ctlRow = "flex h-[70px] max-lg:h-auto max-lg:min-h-[70px] flex-col justify-start gap-1.5";
  // Each period group is a fixed column on desktop so the four labels align;
  // on a phone they stack full-width instead (150+150+132 never fit 343px).
  const periodCol = "w-[150px] max-sm:w-full";

  return (
    <div className="flex gap-3 min-w-0 h-full max-lg:flex-col max-lg:gap-2.5">
      <StepSidebar steps={steps} activeId={activeStep} onSelect={(id) => setActiveStep(id as StepId)} />

        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <div className="min-h-0 space-y-2.5">
        {activeStep === "period" && (
        <div className="rounded-xl border border-line bg-[rgba(17,24,39,0.02)] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className={groupTitle}>
              <span className="msr text-[15px]">calendar_month</span>
              {tf("rental_period", "Rental period")}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-auto"
                checked={allowPast}
                onChange={(e) => setAllowPast(e.target.checked)}
              />
              {tf("allow_past_dates", "Allow past dates")}
            </label>
          </div>

          {/* One band: pick-up → return → duration. Each group is a label over a
              fixed-height control row, so the labels line up and the whole
              period reads left-to-right instead of wrapping into a 4-up grid. */}
          <div className="flex items-start gap-2.5 flex-wrap">
            <div className={periodCol}>
              <span className={lbl}>
                <span className="msr text-[13px] mr-1">login</span>
                {t("start_date")}
              </span>
              <div className={ctlRow}>
                <DateField
                  compact
                  className="!w-full"
                  value={startDate}
                  onChange={setStartDate}
                  min={allowPast ? undefined : todayISO()}
                  // Licensed period: the calendar stops where the server does.
                  max={licenseMax}
                  rangeStart={startDate}
                  rangeEnd={returnDate}
                  ariaLabel={t("start_date")}
                />
                <TimeSelect24
                  compact
                  className="!w-full"
                  value={startTime}
                  onChange={setStartTime}
                  ariaLabel={`${t("start_date")} — ${tf("time", "Time")}`}
                />
              </div>
            </div>

            {/* Centred on the date line, not on the whole stack: it points from
                one day to the other, and the times hang beneath both. */}
            <div className="hidden md:block">
              <span className={lbl}>&nbsp;</span>
              <div className={`${ctlRow} !justify-start text-muted`}>
                <span className="msr text-[18px] h-[33px] leading-[33px]">arrow_right_alt</span>
              </div>
            </div>

            <div className={periodCol}>
              <span className={lbl}>
                <span className="msr text-[13px] mr-1">logout</span>
                {t("return_date")}
              </span>
              <div className={ctlRow}>
                <DateField
                  compact
                  className="!w-full"
                  value={returnDate}
                  onChange={onReturnDateChange}
                  // A rental is at least one day, so the earliest valid return is
                  // the day after pick-up — matches the days >= 1 clamp below.
                  min={addDaysISO(startDate, 1)}
                  max={licenseMax}
                  rangeStart={startDate}
                  rangeEnd={returnDate}
                  ariaLabel={t("return_date")}
                />
                <TimeSelect24
                  compact
                  className="!w-full"
                  value={returnTime}
                  onChange={setReturnTime}
                  ariaLabel={`${t("return_date")} — ${tf("time", "Time")}`}
                />
              </div>
            </div>

            <div className="ml-auto max-sm:ml-0 max-sm:w-full">
              <span className={lbl}>{t("days")}</span>
              <div className={ctlRow}>
                <div className="w-[132px] max-sm:w-full">
                  <Stepper
                    value={days}
                    onChange={(n) => setDays(clampDays(n))}
                    min={1}
                    max={maxDays}
                    ariaLabel={t("days")}
                  />
                </div>
                <div className="text-[11px] text-muted whitespace-nowrap">
                  {tf("cars_free", "Cars available")}: <b className="text-ink">{cars.length}</b>
                </div>
              </div>
            </div>
          </div>

          {/* The calendar simply stops at the licensed year, so this only shows
              when the window was already past it (a booking left open across the
              expiry, say) — it explains the dead days rather than the picker
              silently refusing to move. */}
          {overLicense && (
            <div className="flex items-start gap-1.5 text-[11px] text-danger">
              <span className="msr text-[14px] leading-4">lock_clock</span>
              <span>{licenseCapNote(t, license)}</span>
            </div>
          )}
        </div>
        )}

        {activeStep === "vehicle" && (
          <div className="space-y-2.5 min-w-0">
            <div className={groupTitle}>
              <span className="msr text-[15px]">directions_car</span>
              {tf("deal_terms", "Vehicle & pricing")}
            </div>
            <label className={lbl}>
              {t("select_car")} ({cars.length})
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="!py-1.5">
                {cars.map((c) => (
                  <option key={c.vehicle_id} value={c.vehicle_id}>
                    {c.vehicle_id} · {c.make_model}
                    {c.license_plate ? ` · ${c.license_plate}` : ""}
                  </option>
                ))}
                {cars.length === 0 && <option value="">{t("no_cars")}</option>}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <span className={lbl}>{t("negotiated_rate")} (€)</span>
                <Stepper value={rate} onChange={setRate} step={5} ariaLabel={t("negotiated_rate")} />
              </div>
              <div>
                <span className={lbl}>{t("deposit")} (€)</span>
                <Stepper value={deposit} onChange={setDeposit} step={10} ariaLabel={t("deposit")} />
              </div>
            </div>
            <label className={lbl}>
              {tf("invoice_language", "Invoice language")}
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="!py-1.5">
                {Object.entries(langs).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {activeStep === "client" && (
          <div className="space-y-2.5 min-w-0">
            <div className={groupTitle}>
              <span className="msr text-[15px]">person</span>
              {tf("client_info", "Client Information")}
            </div>
            <label className={lbl}>
              {t("client_name")}
              <input
                className="uppercase-input !py-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className={lbl}>
              {t("client_phone")}
              <input
                className="uppercase-input !py-1.5"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className={lbl}>
              {t("client_id")}
              <input
                className="uppercase-input !py-1.5"
                value={idp}
                onChange={(e) => setIdp(e.target.value)}
              />
            </label>
          </div>
        )}

        {activeStep === "review" && (
          <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,340px)] min-w-0">
            <div className="space-y-2.5 min-w-0">
              <div className={groupTitle}>
                <span className="msr text-[15px]">fact_check</span>
                {tf("review_step", "Review")}
              </div>
              <p className="text-[12px] text-muted leading-snug">
                {tf(
                  "review_step_hint",
                  "Check the invoice preview below, then save the rental once every step above is checked off."
                )}
              </p>
              <ul className="space-y-1.5">
                {steps
                  .filter((s) => s.id !== "review")
                  .map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-[12.5px]">
                      <span
                        className={`msr text-[16px] ${s.complete ? "text-[#16a34a]" : "text-muted"}`}
                      >
                        {s.complete ? "check_circle" : "radio_button_unchecked"}
                      </span>
                      {s.label}
                    </li>
                  ))}
              </ul>
            </div>

            <div className="space-y-2 min-w-0">
              <div className={groupTitle}>
                <span className="msr text-[15px]">receipt_long</span>
                {tf("invoice_preview", "Invoice preview")}
              </div>
              <InvoicePreview
                data={{
                  businessName: biz?.business_name || "—",
                  tagline: biz?.tagline,
                  clientName: name,
                  phone,
                  idPassport: idp,
                  vehicleId,
                  makeModel: car?.make_model || "",
                  licensePlate: car?.license_plate || "",
                  startDate,
                  startTime,
                  returnDate,
                  returnTime,
                  days,
                  dailyRateEuros: rate,
                  depositEuros: deposit,
                  invoiceLang: lang,
                  issuedBy: user?.full_name || user?.username || "",
                }}
              />
              <p className="text-[10px] text-muted leading-snug">
                {tf("invoice_preview_hint", "Live preview — the final PDF is generated on save.")}
              </p>
            </div>
          </div>
        )}
          </div>

          {/* Step nav — Back/Next as a convenience on top of the sidebar. Label
              text drops below `sm` so the row never overflows a narrow phone;
              the icon alone still carries the direction. */}
          <div className="flex items-center justify-between gap-2 shrink-0">
            <button className="btn !px-2.5" onClick={goBack} disabled={stepIndex === 0} title={tf("back", "Back")}>
              <span className="msr text-[16px]">chevron_left</span>
              <span className="max-sm:hidden">{tf("back", "Back")}</span>
            </button>
            {activeStep !== "review" && (
              <button className="btn !px-2.5" onClick={goNext} title={tf("next", "Next")}>
                <span className="max-sm:hidden">{tf("next", "Next")}</span>
                <span className="msr text-[16px]">chevron_right</span>
              </button>
            )}
          </div>

          {/* Footer — running total and the single commit action. Same
              icon-only-on-phone treatment as the step nav above. */}
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-line pt-3 shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-muted">{t("live_total")}</span>
              <span className="font-display font-bold text-accent text-xl">{formatEur(total)}</span>
              {deposit > 0 && (
                <span className="text-[11px] text-muted">
                  − {formatEur(deposit * 100)} = <b className="text-ink">{formatEur(total - deposit * 100)}</b>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {err && <span className="text-xs text-danger">{err}</span>}
              <button className="btn" onClick={onClose} disabled={busy} title={tf("cancel", "Cancel")}>
                <span className="msr text-[16px] sm:hidden">close</span>
                <span className="max-sm:hidden">{tf("cancel", "Cancel")}</span>
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy} title={t("register_btn")}>
                <span className="msr text-[16px]">check</span>
                <span className="max-sm:hidden">{busy ? "…" : t("register_btn")}</span>
              </button>
            </div>
          </div>
        </div>
    </div>
  );
}
