"""Balkan Car Rentals — FastAPI backend.

This package is the REST API that replaces the Streamlit UI. It lives at the repo
root (sibling to ``config/``, ``core/``, ``data/``, ``services/``, ``ui/``) so it
imports those existing, framework-agnostic packages directly — no SQL or business
logic is rewritten. Run from the repo root with::

    uvicorn api.main:app --reload

The existing Streamlit app (``app.py``) is untouched and keeps working.
"""
