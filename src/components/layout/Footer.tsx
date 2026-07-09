import { Link, useLocation } from 'react-router-dom';
import { Phone, Mail, MapPin, Facebook, Instagram, Youtube } from 'lucide-react';
import { SiTiktok } from 'react-icons/si';
import Logo from './Logo';
import { cn } from '@/lib/utils';

export default function Footer({ className }: { className?: string }) {
  const location = useLocation();
  const isFinancing = location.pathname.startsWith('/financing') || location.pathname.startsWith('/apply-now') || location.pathname.startsWith('/apply');

  if (isFinancing) return null;

  return (
    <footer className={cn("bg-gray-900 text-gray-400 py-16", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
          {/* Col 1: Brand */}
          <div className="space-y-6">
            <Link to="/" className="flex items-center space-x-3">
              <Logo variant="white" className="h-10 w-auto" />
              <span className="font-display font-bold text-3xl tracking-tight text-white">
                VAC
              </span>
            </Link>
            <p className="text-sm leading-relaxed">
              The better way to buy a car in Atlantic Canada. Quality vehicles, transparent pricing, and doorstep delivery.
            </p>
            <div className="flex space-x-4">
              {[
                { Icon: Facebook, url: 'https://www.facebook.com/vehicleapprovalcentre' },
                { Icon: Instagram, url: 'https://www.instagram.com/vehicleapprovalcentre' },
                { Icon: SiTiktok, url: 'https://www.tiktok.com/@vehicleapprovalcentre' },
                { Icon: Youtube, url: 'https://www.youtube.com/@vehicleapprovalcentre' }
              ].map((social, i) => (
                <a 
                  key={i} 
                  href={social.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 hover:text-white transition-all"
                >
                  <social.Icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Col 2: Shop */}
          {!isFinancing ? (
            <div>
              <h4 className="text-white font-bold mb-6">Shop</h4>
              <ul className="space-y-4 text-sm">
                {['Honda Civic', 'Toyota RAV4', 'Ford F-150', 'Hyundai Elantra', 'RAM 1500'].map((model) => (
                  <li key={model}>
                    <Link to={`/inventory?search=${model}`} className="hover:text-white transition-colors">
                      {model}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="hidden lg:block"></div>
          )}

          {/* Col 3: Company */}
          <div>
            <h4 className="text-white font-bold mb-6">Company</h4>
            <ul className="space-y-4 text-sm">
              {[
                { name: 'About Us', path: '/about' },
                { name: 'Team', path: '/team' },
                { name: 'Financing', path: '/financing' },
                { name: 'Return Policy', path: '/return-policy' },
                { name: 'Careers', path: '/careers' }
              ].map((link) => (
                <li key={link.name}>
                  <Link to={link.path} className="hover:text-white transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4: Contact */}
          <div>
            <h4 className="text-white font-bold mb-6">Contact Us</h4>
            <div className="space-y-8">
              <ul className="space-y-3 text-sm">
                <li className="flex items-start space-x-3">
                  <MapPin className="h-4 w-4 text-brand-accent shrink-0 mt-0.5" />
                  <span>
                    110 Chain Lake Dr #3B,<br />
                    Halifax, NS B3S 1A9
                  </span>
                </li>
                <li className="flex items-center space-x-3">
                  <Phone className="h-4 w-4 text-brand-accent shrink-0" />
                  <a href="tel:17828305985" className="hover:text-white transition-colors">
                    (782) 830-5985
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row justify-between items-center gap-6 text-sm relative z-10">
          <p>
            © {new Date().getFullYear()} VAC. All rights reserved.
          </p>
          <div className="flex space-x-8">
            <Link to="/privacy" className="hover:text-white transition-colors cursor-pointer">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white transition-colors cursor-pointer">Terms of Service</Link>
            <Link to="/return-policy" className="hover:text-white transition-colors cursor-pointer">Return Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
