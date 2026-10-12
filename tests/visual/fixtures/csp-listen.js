// Classic script, runs before the package: records every CSP violation of the page.
window.cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  window.cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample });
});
