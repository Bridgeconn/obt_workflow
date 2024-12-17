import React, { useState, useMemo } from "react";
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
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import useAuthStore from "@/store/useAuthStore";
import useProjectsStore from "@/store/useProjectsStore";
import { toast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DebouncedInput } from "@/components/DebouncedInput";

const BASE_URL = import.meta.env.VITE_BASE_URL;

// Improved Book Interface
interface Book {
  book_id: number;
  book: string;
  approved: boolean;
}

interface Project {
  id: string;
  name: string;
  owner: string;
  scriptLanguage: string;
  audioLanguage: string;
  books: number;
  approved: number;
  archive: boolean;
}

interface ProjectResponse {
  project_id: number;
  name: string;
  user_name: string;
  script_lang: string;
  audio_lang: string;
  archive: boolean;
  books: Book[];
}

export const fuzzyFilter: FilterFn<Project> = (row, columnId, value) => {
  // Simple case-insensitive filtering
  const cellValue = String(row.getValue(columnId)).toLowerCase();
  const searchValue = value.toLowerCase();

  // Check if the cell value includes the search value
  return cellValue.includes(searchValue);
};

// Fetch projects with proper typing
const fetchProjects = async (): Promise<Project[]> => {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error("Missing token");

  const response = await fetch(`${BASE_URL}/projects/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const responseData = await response.json();
    if (responseData?.detail) {
      toast({
        variant: "destructive",
        title: responseData.detail,
      });
      return [];
    } else {
      throw new Error("Failed to fetch projects");
    }
  }

  const { projects } = await response.json();

  return projects.map((project: ProjectResponse) => ({
    id: project.project_id.toString(),
    name: project.name,
    owner: project.user_name,
    scriptLanguage: project.script_lang,
    audioLanguage: project.audio_lang,
    books: project.books.length,
    approved: project.books.filter((book: Book) => book.approved).length,
    archive: project.archive,
  }));
};

const uploadProject = async (file: File) => {
  const token = useAuthStore.getState().token;
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${BASE_URL}/Projects/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return response.json();
};

const ProjectsPage: React.FC = () => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const { isActive, setActive } = useProjectsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 5,
  });
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const filteredProjects = useMemo(
    () =>
      isActive
        ? projects.filter((p: Project) => !p.archive)
        : projects.filter((p: Project) => p.archive),
    [projects, isActive]
  );

  const uploadMutation = useMutation({
    mutationFn: uploadProject,
    onSuccess: () => {
      toast({
        variant: "success",
        title: "Project uploaded successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (projectId: string) => {
      console.log("Downloading project:", projectId);
    },
    onError: (error: Error) => {
      toast({
        title: "Download Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const columnHelper = createColumnHelper<Project>();
  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => info.getValue(),
    }),
    ...(user && ["Admin", "AI"].includes(user.role || "")
      ? [
          columnHelper.accessor("owner", {
            header: "Owner",
            cell: (info) => info.getValue(),
          }),
        ]
      : []),
    columnHelper.accessor("scriptLanguage", {
      header: "Script Lang",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("audioLanguage", {
      header: "Audio Lang",
      cell: (info) => info.getValue() || "N/A",
    }),
    columnHelper.accessor("books", {
      header: "Books",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("approved", {
      header: "Approved",
      cell: (info) => info.getValue(),
    }),
    columnHelper.display({
      id: "actions",
      header: "DA",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          disabled={row.original.approved === 0}
          onClick={(e) => {
            e.stopPropagation();
            downloadMutation.mutate(row.original.id);
          }}
        >
          <Download size={20} />
        </Button>
      ),
    }),
  ];

  const table = useReactTable({
    data: filteredProjects,
    columns,
    state: {
      globalFilter,
      sorting,
      pagination,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    globalFilterFn: fuzzyFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const { pageIndex } = table.getState().pagination;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadMutation.mutate(files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadMutation.mutate(files[0]);
    }
  };

  return (
    <div
      className="w-full mt-8 px-4 md:px-8 lg:px-12"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold">Projects</h1>
        <div className="flex items-center gap-4">
          <Button onClick={() => setActive(true)} disabled={isActive}>
            Active
          </Button>
          <Button onClick={() => setActive(false)} disabled={!isActive}>
            Archived
          </Button>
          <DebouncedInput
            value={globalFilter ?? ""}
            placeholder="Filter projects..."
            onChange={value => setGlobalFilter(String(value))}
            className="max-w-sm shadow"
          />
          <input
            type="file"
            accept=".zip"
            onChange={handleFileUpload}
            ref={fileInputRef}
            hidden
          />
          <Button onClick={() => fileInputRef.current?.click()}>
            Upload Project
          </Button>
        </div>
      </div>

      <div
        className="mt-10"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          // Check if leaving the drop area
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
          }
        }}
        onDrop={(e) => {
          handleDrop(e);
          setIsDragging(false);
        }}
      >
        {isDragging ? (
          <div className="drag-area flex justify-center items-center h-64 border-2 border-dashed rounded-lg">
            <p>Drop your file here</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}
                      className={ `text-primary ${
                        ["scriptLanguage", "audioLanguage", "books", "approved", "actions"].includes(
                          header.id
                        )
                          ? "text-center"
                          : ""
                      }`}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={columns.length}>Loading...</TableCell>
                  </TableRow>
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length}>
                      No projects found.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => {
                        if (user?.username === row.original.owner) {
                          navigate(`/projects/${row.original.id}`);
                        } else {
                          toast({
                            title: "You are not the owner of this project",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="cursor-pointer hover:bg-gray-100"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}
                        className={
                          ["scriptLanguage", "audioLanguage", "books", "approved", "actions"].includes(
                            cell.column.id
                          )
                            ? "text-center"
                            : "text-left"
                        }>
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
            <div className="flex justify-center items-center gap-4 mt-4">
              <Button
                disabled={pageIndex === 0}
                onClick={() => table.previousPage()}
              >
                Previous
              </Button>
              <span>
                Page {pageIndex + 1} of {table.getPageCount()}
              </span>
              <Button
                disabled={pageIndex >= table.getPageCount() - 1}
                onClick={() => table.nextPage()}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectsPage;
