"""Contact form router — public endpoint for visitor inquiries."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from services import email_service

router = APIRouter(prefix="/api", tags=["contact"])


class ContactFormIn(BaseModel):
    name: str
    email: EmailStr
    message: str


@router.post("/contact", response_model=dict)
async def submit_contact(body: ContactFormIn):
    """Accept visitor contact form and forward to the business."""
    if not body.name or not body.email or not body.message:
        raise HTTPException(status_code=400, detail="Missing required fields")

    subject = f"New inquiry from {body.name}"
    email_body = f"""Name: {body.name}
Email: {body.email}
Message:
{body.message}
"""

    # Send to the business email
    sent, info = email_service.send_mail(
        to="karimihakhamanesh@gmail.com",
        subject=subject,
        body=email_body,
        allow_fallback=True
    )

    if not sent:
        raise HTTPException(status_code=503, detail=f"Email not sent: {info}")

    return {"success": True, "message": "Thank you for reaching out. We'll be in touch soon."}
