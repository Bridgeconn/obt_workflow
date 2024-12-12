import UserMenu from "./Usermenu";

const Navbar = () => {
  return (
    <nav className="bg-gray-800 text-white px-6 py-4 flex justify-between items-center">
      <div className="text-lg font-bold">AI Obt Assistant</div>
      <UserMenu />
    </nav>
  );
};

export default Navbar;
