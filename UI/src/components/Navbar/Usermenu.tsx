import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
  } from "@/components/ui/dropdown-menu";
  import { Avatar } from "@/components/ui/avatar";
  import { useNavigate } from "react-router-dom";
  import useAuthStore from "@/store/useAuthStore";
import { UserIcon } from "lucide-react";
  
  const UserMenu = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    console.log("user details", user);
  
    const handleLogout = async () => {
      await logout();
      navigate("/login");
    };
  
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="h-10 w-10 cursor-pointer flex items-center justify-center bg-gray-600">
            {/* <AvatarFallback>{user?.username.charAt(0)}</AvatarFallback> */}
            <UserIcon className="text-white h-8 w-8" />
          </Avatar>
        </DropdownMenuTrigger>
  
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-2 text-sm font-medium text-gray-600">
            {user?.username || "User"}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/profile")}>
            My Profile
          </DropdownMenuItem>
          {user?.role === "Admin" && (
            <DropdownMenuItem onClick={() => navigate("/users")}>
              Users
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleLogout} className="text-red-500">
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  
  export default UserMenu;