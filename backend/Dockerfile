# Balkan Car Rentals — FastAPI backend image (Railway / Render / any Docker host).
# The bundled DejaVu fonts in assets/fonts/ ship in the image so invoice PDFs render
# Turkish/Albanian glyphs on a host with no system fonts. No streamlit (lean API).
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code (config/core/data/services/ui/api + assets/fonts + seed CSV).
COPY . .

# Don't ship a dev SQLite DB; production binds to Turso/libSQL (TURSO_DATABASE_URL)
# or Postgres (DATABASE_URL). Tables are created on first boot by init_db().
RUN rm -f fleet.db fleet.db-wal fleet.db-shm

ENV PORT=8000
EXPOSE 8000

# init_db() runs once on startup (schema + migrations + seed-if-empty + admin).
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
