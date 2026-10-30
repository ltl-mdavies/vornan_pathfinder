import {csvExport, TEMPLATE_HEADERS} from './catalog';
export function catalogTemplateCsv(customerId: string) {
  const example: Record<string, string> = {
    'Customer Number': customerId, 'Source ID': 'example-001', SKU: 'EXAMPLE-001', Name: 'Example label',
    Product: 'Paper Label', Width: '5', Height: '4', Material: 'White Satin Paper', Laminate: 'None', Varnish: 'Semi-gloss',
    'White Ink Required': 'No', Die: '', Shape: 'Square/Rectangle', 'Spacing (in)': '0.125', 'Corner Radius': '1/8',
    'Cut Type': 'Diecut', Corners: '1/8" Radius Corners', Unwind: '3-Right', 'Roll Mode': 'Max Labels per Roll',
    'Roll Value': '1000', 'Unit Price': '0.056', Approval: 'pending', 'Artwork URL': '', 'Preview URL': ''
  };
  return csvExport([TEMPLATE_HEADERS, TEMPLATE_HEADERS.map(header => example[header] ?? '')]);
}
