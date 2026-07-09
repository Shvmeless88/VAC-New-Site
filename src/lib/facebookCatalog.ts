import { Car } from '../types';
import { slugify } from './utils';

/**
 * Maps Firebase Firestore inventory documents to the format required by the 
 * Facebook Catalog CSV headers (Google Sheets compatible).
 */
export function mapInventoryToFacebookCatalog(inventory: Car[]) {
  return inventory
    .filter(item => item.status !== 'Sold')
    .map(item => {
      // Combines year, make, model, and trim into the title
      const titleParts = [item.year, item.make, item.model, item.trim].filter(Boolean);
      const title = titleParts.join(' ');

      return {
        id: item.id,
        title: title,
        description: item.description || `${title} in excellent condition.`,
        price: `${item.price} CAD`,
        image_link: item.images && item.images.length > 0 ? item.images[0] : '',
        link: `https://vehicleapprovalcentre.com/inventory/${slugify(title)}-${item.id}`,
        make: item.make,
        model: item.model,
        year: item.year,
        brand: item.make,
        body_style: item.bodyStyle,
        state_of_vehicle: 'USED',
        'mileage.value': item.mileage,
        'mileage.unit': 'KM',
        vin: item.vin || '',
        transmission: item.transmission || 'Automatic',
        fuel_type: item.fuelType || 'Gasoline',
        exterior_color: item.exteriorColor || '',
        condition: 'used',
        availability: 'in stock'
      };
    });
}

/**
 * Converts the mapped inventory data into a CSV string.
 */
export function convertToCSV(data: any[]) {
  if (data.length === 0) return '';
  
  // These headers match the Facebook Destination Headers you provided
  const headers = [
    'vehicle_id', 
    'title', 
    'description', 
    'price', 
    'image[0].url', 
    'url', 
    'make', 
    'model', 
    'year', 
    'body_style', 
    'state_of_vehicle', 
    'mileage.value', 
    'mileage.unit'
  ];

  const rows = data.map(obj => 
    headers.map(header => {
      const value = obj[header] ?? '';
      const stringValue = typeof value === 'string' ? value : String(value);
      
      // Escape quotes and wrap in quotes if it contains commas, quotes, or newlines
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
