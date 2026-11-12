import { csvValue, dateStamp } from './utils.js';

export function buildCsv(samples) {
  const first = samples[0].wall;
  const lines = ['timestamp_iso,elapsed_s,voltage_v,current_a,current_ref_a,duty_pct,setpoint_v'];

  for (const sample of samples) {
    lines.push(
      [
        new Date(sample.wall).toISOString(),
        ((sample.wall - first) / 1000).toFixed(3),
        csvValue(sample.v),
        csvValue(sample.i),
        csvValue(sample.iref),
        csvValue(sample.duty),
        csvValue(sample.vset),
      ].join(',')
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(samples) {
  const blob = new Blob([buildCsv(samples)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = `buckscope-${dateStamp(new Date())}.csv`;

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}
