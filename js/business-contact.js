// Formulaire de contact Business : préremplissage par URL et envoi sécurisé.
(function () {
  "use strict";

  var form = document.getElementById("business-contact-form");
  if (!form) return;

  var type = form.elements.type;
  var requestedType = new URLSearchParams(window.location.search).get("type");
  if (requestedType && type && type.querySelector('option[value="' + requestedType + '"]')) {
    type.value = requestedType;
  }

  function value(name) {
    return String(form.elements[name] && form.elements[name].value || "").trim();
  }

  function selectedLabel(select) {
    return select && select.selectedIndex >= 0 ? select.options[select.selectedIndex].text : "";
  }

  function setError(field, visible) {
    var error = document.getElementById(field.id + "-error");
    field.setAttribute("aria-invalid", visible ? "true" : "false");
    if (error) error.hidden = !visible;
  }

  function isEmailValid() {
    var email = value("email");
    return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function setEmailError(visible) {
    var field = form.elements.email;
    var error = document.getElementById("contact-email-error");
    field.setAttribute("aria-invalid", visible ? "true" : "false");
    if (error) error.hidden = !visible;
  }

  function showStatus(kind) {
    var status = document.getElementById("business-contact-status");
    if (!status) return;
    status.hidden = false;
    status.querySelector(".business-contact-success").hidden = kind !== "success";
    status.querySelector(".business-contact-failure").hidden = kind !== "failure";
    status.querySelector(".business-contact-solutions").hidden = kind !== "success";
  }

  ["type", "name", "phone", "message"].forEach(function (name) {
    var field = form.elements[name];
    if (!field) return;
    field.addEventListener("input", function () { setError(field, !value(name)); });
    field.addEventListener("change", function () { setError(field, !value(name)); });
  });
  form.elements.email.addEventListener("input", function () { setEmailError(!isEmailValid()); });
  form.elements.email.addEventListener("change", function () { setEmailError(!isEmailValid()); });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var required = ["type", "name", "phone", "message"];
    var firstInvalid = null;
    required.forEach(function (name) {
      var field = form.elements[name];
      var invalid = !value(name);
      setError(field, invalid);
      if (invalid && !firstInvalid) firstInvalid = field;
    });
    var invalidEmail = !isEmailValid();
    setEmailError(invalidEmail);
    if (firstInvalid || invalidEmail) {
      if (!firstInvalid && invalidEmail) firstInvalid = form.elements.email;
      firstInvalid.focus();
      return;
    }

    var preference = form.querySelector('input[name="preference"]:checked');
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      var response = await fetch("/api/business-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: value("type"), typeLabel: selectedLabel(type), name: value("name"),
          company: value("company"), phone: value("phone"), email: value("email"),
          city: value("city"), postcode: value("postcode"),
          preference: preference ? preference.value : "", message: value("message"),
          source: window.location.href
        })
      });
      if (!response.ok) throw new Error("request failed");
      form.reset();
      if (requestedType) type.value = requestedType;
      ["type", "name", "phone", "message", "email"].forEach(function (name) {
        var field = form.elements[name];
        if (field) field.removeAttribute("aria-invalid");
      });
      showStatus("success");
    } catch (_) {
      showStatus("failure");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}());
