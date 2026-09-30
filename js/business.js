// Interactions légères des pages GETLOCATION Business.
(function () {
  "use strict";
  var form = document.getElementById("business-partner-form");
  if (!form) return;
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var status = document.getElementById("business-form-status");
    var submit = form.querySelector('button[type="submit"]');
    var benefits = Array.prototype.slice.call(form.querySelectorAll('input[name="benefits"]:checked')).map(function (input) { return input.value; });
    if (submit) submit.disabled = true;
    try {
      var response = await fetch("/api/business-partner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name.value, company: form.company.value, email: form.email.value, phone: form.phone.value, message: form.message.value, benefits: benefits }) });
      if (!response.ok) throw new Error("request failed");
      if (status) { status.hidden = false; status.textContent = "Merci, votre demande a bien été envoyée. Notre équipe vous recontactera prochainement."; }
      form.reset();
    } catch (_) {
      if (status) { status.hidden = false; status.textContent = "L'envoi est momentanément indisponible. Veuillez nous contacter par téléphone ou par e-mail."; }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}());
