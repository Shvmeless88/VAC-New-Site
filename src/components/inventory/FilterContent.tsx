import { useState, useMemo, useEffect } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Car, Truck, Search, X } from 'lucide-react';
import { canadianMakes, canadianVehicleMakesAndModels } from '@/data/canadianVehicles';

const bodyStyles = [
  { name: 'SUV', icon: Car },
  { name: 'Sedan', icon: Car },
  { name: 'Truck', icon: Truck },
  { name: 'Hatchback', icon: Car },
  { name: 'Van', icon: Car },
  { name: 'Convertible', icon: Car },
];

export function FilterContent({
  selectedBody,
  setSelectedBody,
  selectedBudget,
  setSelectedBudget,
  priceRange,
  setPriceRange,
  maxDownPayment,
  setMaxDownPayment,
  drivetrain,
  setDrivetrain,
  selectedMakes,
  setSelectedMakes,
  selectedModels,
  setSelectedModels,
  selectedFeatures,
  setSelectedFeatures,
  yearRange,
  setYearRange,
  mileageRange,
  setMileageRange,
  inventory
}: any) {
  const [makeSearch, setMakeSearch] = useState('');

  const availableMakes = useMemo(() => {
    return canadianMakes.filter(make => make.toLowerCase().includes(makeSearch.toLowerCase()));
  }, [makeSearch]);

  const availableModels = useMemo(() => {
    if (selectedMakes.length === 0) return [];
    let models: string[] = [];
    selectedMakes.forEach(make => {
      if (canadianVehicleMakesAndModels[make]) {
        models = [...models, ...canadianVehicleMakesAndModels[make]];
      }
    });
    return models.sort();
  }, [selectedMakes]);

  const handleMakeToggle = (make: string) => {
    setSelectedMakes((prev: string[]) => {
      const isSelected = prev.includes(make);
      if (isSelected) {
        // If unselecting a make, also unselect its models
        const modelsToRemove = canadianVehicleMakesAndModels[make] || [];
        setSelectedModels((prevModels: string[]) => prevModels.filter(m => !modelsToRemove.includes(m)));
        return prev.filter(m => m !== make);
      } else {
        return [...prev, make];
      }
    });
  };

  const handleModelToggle = (model: string) => {
    setSelectedModels((prev: string[]) => 
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
  };

  const budgetOptions = ['< $150', '$150-$200', '$200-$250', '$250-$300', '$300+'];

  return (
    <div className="w-full space-y-6 flex flex-col items-start">
      <Accordion multiple defaultValue={[]} className="w-full">
        
        {/* Payment & Price */}
        <AccordionItem value="payment" className="border-b border-gray-100">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Payment & Price
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 space-y-6">
            <div className="space-y-4">
              <Label className="text-sm font-medium text-[#64748B]">Max Bi-weekly</Label>
              <div className="flex flex-wrap gap-2">
                {budgetOptions.map(budget => (
                  <button
                    key={budget}
                    onClick={() => setSelectedBudget(selectedBudget === budget ? null : budget)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      selectedBudget === budget 
                        ? 'bg-[#7380FF] text-white border-[#7380FF]' 
                        : 'bg-white text-[#41456B] border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {budget}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label className="text-sm font-medium text-[#64748B]">Price Range</Label>
                <span className="text-sm font-bold text-[#41456B]">${(priceRange?.[0] || 0).toLocaleString()} - ${(priceRange?.[1] || 0).toLocaleString()}</span>
              </div>
              <div className="px-1">
                <Slider
                  value={priceRange}
                  onValueChange={(v) => setPriceRange([v[0], v[1]])}
                  min={6000}
                  max={100000}
                  step={1000}
                  className="w-full"
                  indicatorClassName="bg-[#7380FF]"
                  thumbClassName="border-[#7380FF] border-[3px] bg-white size-6 shadow-md rounded-full"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Make & Model */}
        <AccordionItem value="make" className="border-b border-[#E2E8F0]">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Make & Model
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search makes..."
                value={makeSearch}
                onChange={(e) => setMakeSearch(e.target.value)}
                className="h-10 pl-9 text-sm rounded-lg border-gray-200 bg-white focus-visible:ring-brand-primary"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-3 pr-2 custom-scrollbar mt-4">
              {availableMakes.map(make => (
                <div key={make} className="flex items-center space-x-3 group cursor-pointer">
                  <Checkbox 
                    id={`make-${make}`} 
                    checked={selectedMakes.includes(make)}
                    onCheckedChange={() => handleMakeToggle(make)}
                    className="border-gray-300 data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary rounded-sm w-5 h-5"
                  />
                  <label
                    htmlFor={`make-${make}`}
                    className="text-sm font-medium text-[#64748B] group-hover:text-[#41456B] cursor-pointer flex-1"
                  >
                    {make}
                  </label>
                </div>
              ))}
            </div>

            {availableModels.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <Label className="text-sm font-medium text-[#64748B] mb-3 block">Models</Label>
                <div className="max-h-48 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {availableModels.map(model => (
                    <div key={model} className="flex items-center space-x-3 group cursor-pointer">
                      <Checkbox 
                        id={`model-${model}`} 
                        checked={selectedModels.includes(model)}
                        onCheckedChange={() => handleModelToggle(model)}
                        className="border-gray-300 data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary rounded-sm w-5 h-5"
                      />
                      <label
                        htmlFor={`model-${model}`}
                        className="text-sm font-medium text-[#64748B] group-hover:text-[#41456B] cursor-pointer flex-1"
                      >
                        {model}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Body Type */}
        <AccordionItem value="body" className="border-b border-[#E2E8F0]">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Body Type
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedBody('all')}
                className={`p-3 rounded-lg border text-center transition-all ${selectedBody === 'all' ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-gray-200 hover:border-gray-300 text-[#41456B]'}`}
              >
                <span className="text-sm font-medium">All</span>
              </button>
              {bodyStyles.map((style) => (
                <button
                  key={style.name}
                  onClick={() => setSelectedBody(style.name)}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${selectedBody === style.name ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-gray-200 hover:border-gray-300 text-[#41456B]'}`}
                >
                  <style.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{style.name}</span>
                </button>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Year & Mileage */}
        <AccordionItem value="year" className="border-b border-[#E2E8F0]">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Year & Mileage
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label className="text-sm font-medium text-[#64748B]">Year Range</Label>
                <span className="text-sm font-bold text-[#41456B]">{yearRange[0]} - {yearRange[1]}</span>
              </div>
              <Slider
                value={yearRange}
                onValueChange={(v) => setYearRange([v[0], v[1]])}
                min={2015}
                max={2026}
                step={1}
                className="w-full"
                indicatorClassName="bg-[#7380FF]"
                thumbClassName="border-[#7380FF] border-[3px] bg-white size-6 shadow-md rounded-full"
              />
            </div>

            <div className="space-y-4">
              <Label className="text-sm font-medium text-[#64748B]">Mileage</Label>
              <div className="flex flex-col sm:flex-row gap-2 w-full box-border">
                <div className="relative flex-1 min-w-0">
                  <Input 
                    type="text"
                    placeholder="Min"
                    value={mileageRange[0] === 0 ? '' : mileageRange[0].toLocaleString()}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setMileageRange([isNaN(val) ? 0 : val, mileageRange[1]]);
                    }}
                    className="h-10 pl-2 pr-8 rounded-lg border-gray-200 w-full box-border"
                  />
                  <span className="absolute right-2 top-2.5 text-xs text-gray-400 pointer-events-none">km</span>
                </div>
                <div className="relative flex-1 min-w-0">
                  <Input 
                    type="text"
                    placeholder="Max"
                    value={mileageRange[1] === 200000 ? '' : mileageRange[1].toLocaleString()}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setMileageRange([mileageRange[0], isNaN(val) ? 200000 : val]);
                    }}
                    className="h-10 pl-2 pr-8 rounded-lg border-gray-200 w-full box-border"
                  />
                  <span className="absolute right-2 top-2.5 text-xs text-gray-400 pointer-events-none">km</span>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Drivetrain */}
        <AccordionItem value="drivetrain" className="border-b border-[#E2E8F0]">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Drivetrain
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 space-y-3">
            {[
              { id: 'all', label: 'All Drivetrains' },
              { id: 'AWD', label: 'AWD/4WD' },
              { id: 'FWD', label: 'FWD' }
            ].map((dt) => (
              <div key={dt.id} className="flex items-center space-x-3 group cursor-pointer" onClick={() => setDrivetrain(dt.id)}>
                <Checkbox 
                  id={`dt-${dt.id}`} 
                  checked={drivetrain === dt.id}
                  className="border-gray-300 data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary rounded-sm w-5 h-5"
                />
                <label
                  htmlFor={`dt-${dt.id}`}
                  className="text-sm font-medium text-[#64748B] group-hover:text-[#41456B] cursor-pointer flex-1"
                >
                  {dt.label}
                </label>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>

        {/* Features */}
        <AccordionItem value="features" className="border-b border-[#E2E8F0]">
          <AccordionTrigger className="text-base font-bold text-[#41456B] hover:no-underline py-4">
            Advanced Features
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 space-y-4">
            {[
              'Panoramic Sunroof', 'Navigation System', 'Leather / Premium Synthetic Upholstery',
              'Heated Front Seats', 'Backup Camera', 'Apple CarPlay', 'Android Auto',
              'AWD', '360-Degree Surround Camera', 'Adaptive Cruise Control',
              'Blind Spot Monitoring', 'Remote Engine Start', 'Keyless Entry & Push-Button Start'
            ].map((feature) => (
              <div key={feature} className="flex items-center space-x-3 group cursor-pointer">
                <Checkbox 
                  id={`feature-${feature}`} 
                  checked={(selectedFeatures || []).includes(feature)}
                  onCheckedChange={() => {
                    const current = selectedFeatures || [];
                    const next = current.includes(feature)
                      ? current.filter((f: string) => f !== feature)
                      : [...current, feature];
                    setSelectedFeatures(next);
                  }}
                  className="border-gray-300 data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary rounded-sm w-5 h-5"
                />
                <label
                  htmlFor={`feature-${feature}`}
                  className="text-sm font-medium text-[#64748B] group-hover:text-[#41456B] cursor-pointer flex-1"
                >
                  {feature}
                </label>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
