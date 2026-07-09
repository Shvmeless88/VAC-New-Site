import React from 'react';
import { RotateCw, Smartphone } from 'lucide-react';

export default function VirtualTourWidget() {
  return (
    <div className="my-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-6 rounded-2xl flex flex-col sm:flex-row items-center gap-6">
      <div className="bg-blue-600 text-white p-4 rounded-full shadow-lg shrink-0">
        <RotateCw className="h-8 w-8" />
      </div>
      <div className="flex-grow text-center sm:text-left">
        <h3 className="text-xl font-bold text-blue-900 mb-2">Powered by Car Turner Technology</h3>
        <p className="text-blue-800/80 text-sm">
          Experience total visual transparency. Our high-definition 360° walkarounds allow you to inspect every detail of this vehicle from any device.
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2 text-blue-600 font-bold bg-white px-4 py-2 rounded-full shadow-sm border border-blue-100">
        <Smartphone className="h-4 w-4" />
        <span>Mobile Ready</span>
      </div>
    </div>
  );
}
