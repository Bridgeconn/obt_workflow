import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Edit } from "lucide-react";
import useAuthStore from "@/store/useAuthStore";
import { toast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface User {
  user_id: string;
  username: string;
  email: string;
  role: string;
  last_login: string;
  token: string;
  active: boolean;
  created_date: string;
}

interface UpdateUserParams {
  role?: string;
  active?: string;
}

interface UpdateResponse {
  success: boolean;
  error?: string;
}

const fetchUsers = async (token: string | null): Promise<User[]> => {
  if (!token) throw new Error("Missing token");

  const response = await fetch(`${BASE_URL}/users/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch users");
  }

  return response.json();
};

const UsersTable = () => {
  const { token, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedActive, setSelectedActive] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', token],
    queryFn: () => fetchUsers(token),
    enabled: !!token,
    retry: false,
  });

  const updateUser = async (userId: string, updates: UpdateUserParams): Promise<UpdateResponse> => {
    try {
      setIsUpdating(true);
      
      // Build query params
      const params = new URLSearchParams({ user_id: userId });
      if (updates.role) params.append('role', updates.role);
      if (updates.active) params.append('active', (updates.active === "Yes").toString());
  
      const response = await fetch(
        `${BASE_URL}/user/?${params.toString()}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to update user");
      }
  
      queryClient.invalidateQueries({ queryKey: ['users', token] });
      return { success: true };
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : "Failed to update user" 
      };
    } finally {
      setIsUpdating(false);
    }
  };
  

  const openModal = (userToEdit: User) => {
    setSelectedUser(userToEdit);
    setSelectedRole(userToEdit.role);
    setSelectedActive(userToEdit.active ? "Yes" : "No");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedUser(null);
    setSelectedRole("");
    setSelectedActive(""); 
  };

  const handleUpdate = async () => {
    if (!selectedUser) return;

    const updates: UpdateUserParams = {};
    let hasChanges = false;

  
    if (selectedRole !== selectedUser.role) {
      updates.role = selectedRole;
      hasChanges = true;
    }
  
    if ((selectedActive === "Yes") !== selectedUser.active) {
      updates.active = selectedActive;
      hasChanges = true;
    }

    if (!hasChanges) {
      toast({
        variant: "destructive",
        title: "No Changes found!",
      });
      closeModal();
      return;
    }

    const result = await updateUser(selectedUser.user_id, updates);
  
    if (result.success) {
      toast({
        variant: "success",
        title: "User Updated"
      });
    } else {
      toast({
        variant: "destructive",
        title: result.error || "Failed to update user",
      });
    }
    closeModal();
  };
  
  

  if (isLoading) return <p>Loading...</p>;

  return (
    <div className="w-full mt-12 px-4 md:px-8 lg:px-12">
      <h1 className="text-3xl font-bold mb-4">Application Users</h1>
      <div className="w-full overflow-x-auto max-h-[420px] overflow-y-auto">
        <Table className="w-full min-w-[800px] border">
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Created Date</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length > 0 ? (
              users.map((userRow) => (
                <TableRow key={userRow.user_id}>
                  <TableCell>{userRow?.username || "N/A"}</TableCell>
                  <TableCell>{userRow?.email || "N/A"}</TableCell>
                  <TableCell>{userRow?.last_login || "N/A"}</TableCell>
                  <TableCell>{userRow?.active ? "Yes" : "No"}</TableCell>
                  <TableCell>{userRow?.created_date || "N/A"}</TableCell>
                  <TableCell>{userRow?.role || "N/A"}</TableCell>
                  <TableCell>
                    {user?.user_id !== userRow.user_id && (
                      <Button
                        variant="outline"
                        className="flex items-center gap-2"
                        onClick={() => openModal(userRow)}
                      >
                        <Edit className="w-4 h-4" /> Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7}>No users found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Role Modal */}
      <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className='text-3xl font-bold text-center'>Edit User</DialogTitle>
          </DialogHeader>
          <div>
          <h3 className="text-lg font-semibold my-3">Role</h3>
          <RadioGroup
            value={selectedRole}
            onValueChange={setSelectedRole}
            className="space-y-2 mb-3"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="Admin" id="admin" />
              <label htmlFor="admin">Admin</label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="AI" id="ai" />
              <label htmlFor="ai">AI</label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="User" id="user" />
              <label htmlFor="user">User</label>
            </div>
          </RadioGroup>
          </div>
          <div>
          <h3 className="text-lg font-semibold my-3">Active</h3>
          <RadioGroup
            value={selectedActive}
            onValueChange={setSelectedActive}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="Yes" id="yes" />
              <label htmlFor="yes">Yes</label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="No" id="no" />
              <label htmlFor="no">No</label>
            </div>
          </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!selectedRole || !selectedActive || isUpdating}
            >
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersTable;
