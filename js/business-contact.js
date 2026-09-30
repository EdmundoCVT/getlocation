// Formulaire de contact Business : préremplissage par URL et message WhatsApp.
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

  ["type", "name", "phone", "message"].forEach(function (name) {
    var field = form.elements[name];
    if (!field) return;
    field.addEventListener("input", function () { setError(field, !value(name)); });
    field.addEventListener("change", function () { setError(field, !value(name)); });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var required = ["type", "name", "phone", "message"];
    var firstInvalid = null;
    required.forEach(function (name) {
      var field = form.elements[name];
      var invalid = !value(name);
      setError(field, invalid);
      if (invalid && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    var preference = form.querySelector('input[name="preference"]:checked');
    var city = [value("city"), value("postcode")].filter(Boolean).join(" ");
    var lines = [
      "Bonjour GetLocation,",
      "",
      "Je souhaite être recontacté pour une demande professionnelle.",
      "",
      "Type de demande : " + selectedLabel(type),
      "Nom : " + value("name"),
      "Société : " + value("company"),
      "Téléphone : " + value("phone"),
      "Email : " + value("email"),
      "Ville : " + city,
      "Préférence de contact : " + (preference ? preference.value : ""),
      "Message : " + value("message"),
      "",
      "Merci."
    ];
    var url = "https://wa.me/33667485430?text=" + encodeURIComponent(lines.join("\n"));
    window.open(url, "_blank", "noopener");
  });
}());
