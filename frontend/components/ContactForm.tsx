"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";

export function ContactForm() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.email.trim() || !formData.message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      const response = await api("/api/contact", {
        method: "POST",
        body: JSON.stringify(formData),
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();
      if (response.ok) {
        toast.success(data.message || "Thank you! We'll be in touch soon.");
        setFormData({ name: "", email: "", message: "" });
      } else {
        toast.error(data.detail || "Failed to send message");
      }
    } catch (error) {
      toast.error("Failed to send message. Please try again.");
      console.error("Contact form error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl md:text-4xl font-bold">Let's create something.</h2>
        <p className="text-muted">Tell me a little about your project and I'll be in touch.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            name="name"
            placeholder="Name"
            value={formData.name}
            onChange={handleChange}
            className="w-full px-0 py-3 border-b border-border bg-transparent text-ink placeholder-muted focus:outline-none focus:border-accent"
            disabled={loading}
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            className="w-full px-0 py-3 border-b border-border bg-transparent text-ink placeholder-muted focus:outline-none focus:border-accent"
            disabled={loading}
          />
        </div>

        <textarea
          name="message"
          placeholder="Tell me about your project"
          value={formData.message}
          onChange={handleChange}
          rows={6}
          className="w-full px-0 py-3 border-b border-border bg-transparent text-ink placeholder-muted focus:outline-none focus:border-accent resize-none"
          disabled={loading}
        />

        <div className="flex justify-center pt-6">
          <button
            type="submit"
            disabled={loading}
            className="px-12 py-3 bg-amber-500 text-black font-semibold uppercase tracking-wider hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Sending..." : "Send Message"}
          </button>
        </div>
      </form>
    </div>
  );
}
