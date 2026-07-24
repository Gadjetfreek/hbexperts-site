// Mobile nav toggle
document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function() {
      links.classList.toggle('active');
      toggle.setAttribute('aria-expanded', links.classList.contains('active'));
    });
  }
});
