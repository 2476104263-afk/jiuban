import { buildAnnualReport } from './annual-report.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ report: buildAnnualReport(data.messages, data.options) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
