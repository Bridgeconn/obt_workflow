import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  SortingState,
  getSortedRowModel,
  FilterFn,
} from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Edit, Search } from "lucide-react";
import useAuthStore from "@/store/useAuthStore";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { DebouncedInput } from "@/components/DebouncedInput";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface User {
  user_id: string;
  username: string | null;
  email: string | null;
  role: string | null;
  last_login: string | null;
  token: string;
  active: boolean | null;
  created_date: string | null;
}

interface UpdateUserParams {
  role?: string;
  active?: string;
}

interface UpdateResponse {
  success: boolean;
  error?: string;
}

// Fuzzy filter implementation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const fuzzyFilter: FilterFn<User> = (row, columnId, value, _addMeta) => {
  const searchValue = value.toLowerCase().trim();
  
  // Get the raw value from the row
  const rawValue = row.getValue(columnId);
  
  // Handle null values
  if (rawValue === null) {
    return false;
  }

  // Special handling for the active column
  if (columnId === 'active') {
    const boolValue = rawValue as boolean;
    if (searchValue === 'yes' || searchValue === 'true') {
      return boolValue === true;
    }
    if (searchValue === 'no' || searchValue === 'false') {
      return boolValue === false;
    }
  }

  // Convert the raw value to string and search
  const cellValue = String(rawValue).toLowerCase().trim();
  
  // Exact match for role
  if (columnId === 'role') {
    return cellValue === searchValue;
  }

  // Partial match for other fields
  return cellValue.includes(searchValue);
};

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
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedActive, setSelectedActive] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 5,
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users", token],
    queryFn: () => fetchUsers(token),
    enabled: !!token,
    retry: false,
  });

  const columnHelper = createColumnHelper<User>();
  const columns = [
    columnHelper.accessor("username", {
      header: "Username",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("last_login", {
      header: "Last Login",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("active", {
      header: "Active",
      cell: (info) => (info.getValue() ? "Yes" : "No"),
    }),
    columnHelper.accessor("created_date", {
      header: "Created Date",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("role", {
      header: "Role",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        user?.user_id !== row.original.user_id ? (
          <Button
            variant="outline"
            className="flex items-center gap-2"
            onClick={(e) => {
              e.stopPropagation();
              openModal(row.original);
            }}
          >
            <Edit className="w-4 h-4" /> Edit
          </Button>
        ) : (
          // Invisible placeholder button to maintain consistent row height
          <Button
            variant="outline"
            className="flex items-center gap-2 invisible"
          >
            <Edit className="w-4 h-4" /> Edit
          </Button>
        )
      ),
    }),
  ];

  const table = useReactTable({
    data: users,
    columns,
    state: {
      globalFilter,
      sorting,
      pagination,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    globalFilterFn: (row, columnId, filterValue, addMeta) => {
      // Search across all searchable columns
      const searchableColumns = ['username', 'email', 'role', 'active'];
      return searchableColumns.some(column => 
        fuzzyFilter(row, column, filterValue, addMeta)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const updateUser = async (
    userId: string,
    updates: UpdateUserParams
  ): Promise<UpdateResponse> => {
    try {
      setIsUpdating(true);

      // Build query params
      const params = new URLSearchParams({ user_id: userId });
      if (updates.role) params.append("role", updates.role);
      if (updates.active)
        params.append("active", (updates.active === "Yes").toString());

      const response = await fetch(`${BASE_URL}/user/?${params.toString()}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to update user");
      }

      queryClient.invalidateQueries({ queryKey: ["users", token] });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update user",
      };
    } finally {
      setIsUpdating(false);
    }
  };

  const openModal = (userToEdit: User) => {
    setSelectedUser(userToEdit);
    setSelectedRole(userToEdit?.role || "");
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
        title: "User Updated",
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
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
        <h1 className="text-3xl font-bold">Application Users</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
            <DebouncedInput
              value={globalFilter ?? ""}
              onChange={(value) => setGlobalFilter(String(value))}
              placeholder="Search users"
              className="pl-8 pr-4 w-64 shadow-sm"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="ml-2"
          >
            Close
          </Button>
        </div>
      </div>
      <div className="relative min-w-[800px] overflow-y-hidden h-[420px] border-2 rounded-lg">
        <Table>
          <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-center gap-2 mt-4">
        <Button
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          {`<`}
        </Button>
        <span className="flex items-center gap-1">
          <div>Page</div>
            {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
        </span>
        <Button
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          {`>`}
        </Button>
      </div>

      {/* Edit Role Modal */}
      <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-3xl font-bold text-center">
              Edit User
            </DialogTitle>
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
