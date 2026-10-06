import { GiGavel } from 'react-icons/gi';
export default function Logo({ light = false }) { return <div className={`logo ${light ? 'logo-light' : ''}`}><span className="logo-mark"><GiGavel /></span><span>Dastavez<span className="logo-dot">.</span></span></div>; }
