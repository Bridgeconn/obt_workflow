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
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import useAuthStore from "@/store/useAuthStore";
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

interface DateInfo {
  display: string;
  full: string;
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
  createdDate: DateInfo;
  exported?: boolean;
  exported_date?: string;
}

interface ProjectResponse {
  project_id: number;
  name: string;
  user_name: string;
  script_lang: string;
  audio_lang: string;
  archive: boolean;
  created_date: string;
  exported?: boolean;
  exported_date?: string;
  books: Book[];
}

interface UploadProjectResponse {
  message: string;
  project_id: string;
  result: {
    status: string;
    incompartible_verses: string[];
  };
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
  const { token, user } = useAuthStore.getState();
  // if (!token) throw new Error("Missing token");
  if (!token || !user) {
    return [];
  }

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

  return projects.map((project: ProjectResponse) => {
    // Format the date for display
    const date = new Date(project.created_date);
    const displayDate = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const fullDateTime = date.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return {
      id: project.project_id.toString(),
      name: project.name,
      owner: project.user_name,
      scriptLanguage: project.script_lang,
      audioLanguage: project.audio_lang,
      books: project.books.length,
      approved: project.books.filter((book: Book) => book.approved).length,
      archive: project.archive,
      createdDate: {
        display: displayDate,
        full: fullDateTime,
      },
      exported: project.exported ?? false,
      exported_date: project.exported_date,
    };
  });
};

const exportToS3 = async (projectId: string): Promise<any> => {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${BASE_URL}/export_to_s3/${projectId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
  return res.json();
};

const uploadProject = async (
  file: File,
  onProgress: (progress: number) => void
): Promise<UploadProjectResponse> => {
  const token = useAuthStore.getState().token;
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/projects`, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const response: UploadProjectResponse = JSON.parse(xhr.responseText);
        resolve(response);
      } else {
        const errorResponse = JSON.parse(xhr.responseText);
        reject(new Error(errorResponse.detail || "Failed to upload project"));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(formData);
  });
};

const downloadProject = async (projectId: string, name: string) => {
  const response = await fetch(
    `${BASE_URL}/download-processed-project-zip/?project_id=${projectId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${useAuthStore.getState().token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const responseData = await response.json();
    throw new Error(responseData.detail || "Failed to download zip file");
  }
  const contentDisposition = response.headers.get("Content-Disposition");
  let fileName = `${name}.zip`;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="([^"]+)"/);
    if (match && match[1]) {
      fileName = match[1];
    }
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const ProjectsPage: React.FC = () => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [isActive, setActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 5,
  });
  const [showDialog, setShowDialog] = useState(false);
  const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);

  // Add state for dynamic height
  // const [containerHeight, setContainerHeight] = useState<string>("auto");
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const isAdmin = user?.role === "Admin";

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects", user?.username],
    queryFn: fetchProjects,
    enabled: !!user,
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
    mutationFn: (file: File) => uploadProject(file, setUploadProgress),
    onSuccess: (data: UploadProjectResponse) => {
      const { message, result } = data;
      const incompartible_verses = result?.incompartible_verses || [];

      let successDescription = ""; // Default to empty description

      // If there are incompatible verses, include them in the description
      if (incompartible_verses.length > 0) {
        successDescription = `${incompartible_verses.length} verse file(s) skipped due to file incompatibility`;
      }

      // Show the success toast, only including the description if there are incompatible verses
      toast({
        variant: "success",
        title: message,
        description: successDescription,
      });

      // Reset progress and invalidate queries
      setUploadProgress(0);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => {
      toast({
        title: error instanceof Error ? error?.message : "Upload failed",
        variant: "destructive",
      });
      setUploadProgress(0);
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportToS3,
    onSuccess: (data) => {
      toast({ variant: "success", title: data.message });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: err.message });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      downloadProject(projectId, name),
    onSuccess: () => {
      toast({
        variant: "success",
        title: "Project downloaded successfully!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: error instanceof Error ? error?.message : "Download failed",
        variant: "destructive",
      });
    },
  });

  const columnHelper = createColumnHelper<Project>();
  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => (
        <div className="w-[120px] truncate" title={info.getValue()}>
          {info.getValue()}
        </div>
      ),
      size: 120,
    }),
    ...(user && ["Admin", "AI"].includes(user.role || "")
      ? [
          columnHelper.accessor("owner", {
            header: "Owner",
            cell: (info) => (
              <div className="w-[100px] truncate" title={info.getValue()}>
                {info.getValue()}
              </div>
            ),
            size: 100,
          }),
        ]
      : []),

    columnHelper.accessor("audioLanguage", {
      header: "Audio Language",
      cell: (info) => (
        <div className="w-[80px] truncate" title={info.getValue() || "N/A"}>
          {info.getValue() || "N/A"}
        </div>
      ),
      size: 80,
    }),

    columnHelper.accessor("scriptLanguage", {
      header: "Script Language",
      cell: (info) => (
        <div className="w-[80px] truncate" title={info.getValue() || "N/A"}>
          {info.getValue() || "N/A"}
        </div>
      ),
      size: 80,
    }),
    columnHelper.accessor("books", {
      header: "Books",
      cell: (info) => (
        <div className="truncate text-center">{info.getValue()}</div>
      ),
      size: 50,
    }),
    columnHelper.accessor("approved", {
      header: "Approved",
      cell: (info) => (
        <div className="truncate text-center">{info.getValue()}</div>
      ),
      size: 50,
    }),
    columnHelper.accessor("createdDate", {
      header: "Created Date",
      cell: (info) => (
        <div className="truncate text-center" title={info.getValue().full}>
          {info.getValue().display}
        </div>
      ),
      size: 80,
    }),
    columnHelper.display({
      id: "actions",
      header: "Download",
      cell: ({ row }) => (
        <div className="truncate text-center">
          <Button
            variant="ghost"
            size="icon"
            disabled={row.original.approved === 0}
            onClick={(e) => {
              e.stopPropagation();
              downloadMutation.mutate({
                projectId: row.original.id,
                name: row.original.name,
              });
            }}
          >
            <Download size={20} />
          </Button>
        </div>
      ),
      size: 50,
    }),
    ...(user && user?.role === "AI"
      ? [
          columnHelper.display({
            id: "action",
            header: "Action",
            cell: ({ row }) => (
              <div className="flex justify-center text-center items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialogProjectId(row.original.id);
                    setShowDialog(true);
                  }}
                  title="Upload to S3"
                  disabled = {row.original.approved === 0}
                >
                  {exportMutation.isPending &&
                  exportMutation.variables === row.original.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload size={18} />
                  )}
                </Button>
                {row.original.exported && (
                  <span title={`Uploaded: ${row.original.exported_date ?? "Not found"}`}>
                    ✅
                  </span>
                )}
              </div>
            ),
            size: 50,
          }),
        ]
      : []),
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
      uploadFile(files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  };

  const uploadFile = (file: File) => {
    uploadMutation.mutate(file);

    // Reset file input to allow re-uploading the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full mt-8 px-4 md:px-8 lg:px-12">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-4">
        <h1 className="text-3xl font-bold">Projects</h1>
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-4 md:justify-start">
          {isAdmin && (
            <div className="flex items-center space-x-2">
              <Switch
                id="archive-mode"
                checked={isActive}
                onCheckedChange={setActive}
              />
              <Label htmlFor="archive-mode" className="font-medium">
                {isActive ? "Active" : "Deleted"}
              </Label>
            </div>
          )}
          <DebouncedInput
            value={globalFilter ?? ""}
            placeholder="Search Projects"
            onChange={(value) => setGlobalFilter(String(value))}
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
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
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
            {uploadProgress > 0 && (
              <div className="mb-4">
                <div
                  className="bg-green-500 h-1 rounded"
                  style={{ width: `${uploadProgress}%` }}
                />
                <p className="text-center">{`Uploading: ${Math.round(
                  uploadProgress
                )}%`}</p>
              </div>
            )}
            <div className="relative overflow-hidden h-[420px] border-2 rounded-lg">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          style={{ width: `${header.column.getSize()}px` }}
                          className={`text-primary bg-gray-100 ${
                            [
                              "books",
                              "approved",
                              "actions",
                              "createdDate",
                              "action"
                            ].includes(header.id)
                              ? "text-center"
                              : "text-left justify-start"
                          }`}
                        >
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
                          if (user?.username === row.original.owner || isAdmin) {
                            navigate(`/projects/${row.original.id}`);
                          } else {
                            toast({
                              title: "You are not the owner of this project",
                              variant: "destructive",
                            });
                          }
                        }}
                        title={`Project id: ${row.original.id}`}
                        className="cursor-pointer hover:bg-gray-100"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            style={{
                              width: `${cell.column.getSize()}px`,
                              justifyItems: [
                                "books",
                                "approved",
                                "actions",
                                "createdDate",
                                "action"
                              ].includes(cell.column.id)
                                ? "center"
                                : "start",
                            }}
                          >
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
            <div className="flex justify-center items-center gap-4 mt-4">
              <Button
                disabled={pageIndex === 0}
                onClick={() => table.previousPage()}
              >
                {`<`}
              </Button>
              <span>
                Page {pageIndex + 1} of {table.getPageCount()}
              </span>
              <Button
                disabled={pageIndex >= table.getPageCount() - 1}
                onClick={() => table.nextPage()}
              >
                {`>`}
              </Button>
            </div>
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Upload to S3</DialogTitle>
                </DialogHeader>
                <p>Are you sure you want to upload this project to S3?</p>
                <DialogFooter className="mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (dialogProjectId) {
                        exportMutation.mutate(dialogProjectId);
                      }
                      setShowDialog(false);
                    }}
                  >
                    Confirm
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectsPage;