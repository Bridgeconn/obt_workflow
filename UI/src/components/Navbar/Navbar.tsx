import UserMenu from "./Usermenu";
import { Link } from "react-router-dom";

const Navbar = () => {
  return (
    <nav className="bg-gray-800 text-white px-6 py-4 flex justify-between items-center sticky top-0 z-10">
      <Link to="/" className="text-lg font-bold">
        <div className="text-lg font-bold">AI Obt Assistant</div>
      </Link>
      <UserMenu />
    </nav>
  );
};

export default Navbar;
