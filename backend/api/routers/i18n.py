"""i18n router — serves the translation tables + rental terms to the frontend.

The 453-key × 6-language ``TRANSLATIONS`` registry and ``RENTAL_TERMS`` are reused
verbatim. The frontend loads its language bundle once and looks keys up client-side;
documents (invoices) render server-side via the session-free ``t_lang(key, lang)``.
"""
from __future__ import annotations

from fastapi import APIRouter

from config.i18n import TRANSLATIONS
from config.settings import DEFAULT_LANG, LANGUAGES, STAFF_ONLY_LANGS
from config.terms import rental_terms

router = APIRouter(prefix="/api/i18n", tags=["i18n"])


@router.get("/languages")
def languages() -> dict:
    """The selectable-language registry (code -> 'flag + endonym') + staff-only set."""
    return {
        "languages": LANGUAGES,
        "default": DEFAULT_LANG,
        "staff_only": sorted(STAFF_ONLY_LANGS),
    }


@router.get("/terms/{lang}")
def terms(lang: str) -> dict:
    """Rental terms (title + 13 rules) for the invoice, in the document language."""
    return rental_terms(lang)


@router.get("/{lang}.json")
def bundle(lang: str) -> dict:
    """All UI strings for one language (falls back to the default if unknown)."""
    return TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANG])
