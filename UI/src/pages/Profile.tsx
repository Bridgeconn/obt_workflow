import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import useAuthStore from "@/store/useAuthStore";
import { useToast } from "@/hooks/use-toast";
import { DialogDescription } from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";

const BASE_URL = import.meta.env.VITE_BASE_URL;

type PasswordFormInputs = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const ProfilePage: React.FC = () => {
  const [isModalOpen, setModalOpen] = useState(false);
  const { token, user } = useAuthStore();
  const { toast } = useToast();
  const navigate = useNavigate();

  const form = useForm<PasswordFormInputs>({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const handleOpenModal = () => setModalOpen(true);
  const handleCloseModal = () => {
    form.reset();
    setModalOpen(false);
  };

  const handleChangePassword = async (formData: PasswordFormInputs) => {
    try {
      const response = await fetch(
        `${BASE_URL}/user/updatePassword/?current_password=${formData.currentPassword}&new_password=${formData.newPassword}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("response", response)
      const responseData = await response.json();
      console.log("Password changed successfully", responseData);
      if (!response.ok) {
        throw new Error(responseData.detail || "Failed to change password");
      }
      toast({
        variant: "success",
        title: "Password changed successfully.",
      });
      form.reset();
      handleCloseModal();
    } catch (error) {
      console.error("Password change failed", error);
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Failed to change password.",
        // description: error instanceof Error ? error.message : "Failed to change password.",
      });
    }
  };
  

  return (
    <div className="p-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-bold">My Profile</CardTitle>
          <CardDescription aria-label="Manage your profile details">Manage your profile details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p>
              <span className="font-semibold">Username: </span> {user?.username || "N/A"}
            </p>
            <p>
              <span className="font-semibold">Email: </span> {user?.email || "N/A"}
            </p>
            <p>
              <span className="font-semibold">Role: </span> {user?.role || "N/A"}
            </p>
            <p>
              <span className="font-semibold">Created Date: </span> {user?.created_date || "N/A"}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => navigate("/")}>Close</Button>
          <Button onClick={handleOpenModal}>Change Password</Button>
        </CardFooter>
      </Card>

      {/* Modal for changing password */}
      <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription />
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleChangePassword)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="currentPassword"
                rules={{
                  required: "Current Password is required",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                rules={{
                  required: "Please enter a new password",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                rules={{
                  required: "Please confirm your new password",
                  validate: (value) =>
                    value === form.getValues("newPassword") ||
                    "Passwords do not match",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="flex justify-between items-center w-full">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseModal}
                >
                  Close
                </Button>
                <Button type="submit">Change Password</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfilePage;
