import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SellOrTradeModal({ isOpen, onClose }: ModalProps) {
  const [step, setStep] = useState(1);

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold">Vehicle Details</h3>
            <Input placeholder="Year" />
            <Input placeholder="Make" />
            <Input placeholder="Model" />
            <Input placeholder="Trim" />
            <Input placeholder="Mileage (km)" />
            <Button onClick={() => setStep(2)}>Next</Button>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold">Condition</h3>
            <div className="space-y-2">
              <Label>Accidents over $2,000?</Label>
              <div className="flex gap-2">
                <Button variant="outline">Yes</Button>
                <Button variant="outline">No</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mechanical issues?</Label>
              <div className="flex gap-2">
                <Button variant="outline">Yes</Button>
                <Button variant="outline">No</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dashboard warning lights?</Label>
              <div className="flex gap-2">
                <Button variant="outline">Yes</Button>
                <Button variant="outline">No</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Smoked in?</Label>
              <div className="flex gap-2">
                <Button variant="outline">Yes</Button>
                <Button variant="outline">No</Button>
              </div>
            </div>
            <Button onClick={() => setStep(3)}>Next</Button>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold">Ownership</h3>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Select ownership status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owned">Owned</SelectItem>
                <SelectItem value="financed">Financed</SelectItem>
                <SelectItem value="leased">Leased</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setStep(4)}>Next</Button>
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-xl font-bold">Success</h3>
            <p>Analyzing your data... we'll text your firm offer in 2 minutes!</p>
            <Input placeholder="Phone Number" />
            <Input placeholder="Email" />
            <Button onClick={onClose}>Finish</Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Sell or Trade</DialogTitle>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
