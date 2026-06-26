"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatEur } from "@/lib/money";
import type { LanguagesInfo } from "@/lib/types";

interface FreeCar {
  vehicle_id: string;
  make_model: string;
  license_plate: string;
  base_daily_rate: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Quick Rental Registration. LEFT column = booking details (date/time, vehicle,
 * rate, deposit, language, live total, save); RIGHT column = the client's personal
 * info. `preselectVehicleId` pre-picks a car (used by the dashboard "Rent" buttons).
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
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));

  const [startDate, setStartDate] = useState(todayISO());
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

  useEffect(() => {
    apiGet<LanguagesInfo>("/api/i18n/languages").then((d) => setLangs(d.languages)).catch(() => {});
  }, []);

  useEffect(() => {
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
  }, [startDate, startTime, days, returnTime, preselectVehicleId]);

  const car = cars.find((c) => c.vehicle_id === vehicleId);
  useEffect(() => {
    if (car) setRate(Math.max(0, Math.round(car.base_daily_rate / 100)));
  }, [vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => days * rate * 100, [days, rate]);

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setErr(t("register_need_fields"));
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
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  const lbl = "text-xs text-muted block mb-1";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* LEFT — booking details */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("availability_title")}</h3>
        <label className={lbl}>
          {t("start_date")}
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>
            {t("start_time")}
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className={lbl}>
            {t("days")}
            <input type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, +e.target.value))} />
          </label>
        </div>
        <label className={lbl}>
          {t("return_time")}
          <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
        </label>
        <label className={lbl}>
          {t("select_car")} ({cars.length})
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {cars.map((c) => (
              <option key={c.vehicle_id} value={c.vehicle_id}>
                {c.vehicle_id} · {c.make_model}
              </option>
            ))}
            {cars.length === 0 && <option value="">{t("no_cars")}</option>}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>
            {t("negotiated_rate")} (€)
            <input type="number" min={0} value={rate} onChange={(e) => setRate(Math.max(0, +e.target.value))} />
          </label>
          <label className={lbl}>
            {t("deposit")} (€)
            <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(Math.max(0, +e.target.value))} />
          </label>
        </div>
        <label className={lbl}>
          {t("language")}
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {Object.entries(langs).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between pt-1">
          <span className={lbl}>{t("live_total")}</span>
          <span className="font-display font-bold text-accent text-lg">{formatEur(total)}</span>
        </div>
        {err && <div className="text-sm text-danger">{err}</div>}
        <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
          {busy ? "…" : t("register_btn")}
        </button>
      </div>

      {/* RIGHT — client personal info */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{tf("client_info", "Client Information")}</h3>
        <label className={lbl}>
          {t("client_name")}
          <input className="uppercase-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={lbl}>
          {t("client_phone")}
          <input className="uppercase-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className={lbl}>
          {t("client_id")}
          <input className="uppercase-input" value={idp} onChange={(e) => setIdp(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
