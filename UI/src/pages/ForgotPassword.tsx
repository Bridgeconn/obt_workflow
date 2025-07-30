import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { Card, CardTitle, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface ForgotPasswordForm {
  email: string;
}

const ForgotPassword: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const form = useForm<ForgotPasswordForm>({
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    console.log("data", data);
    setLoading(true);
    try {
      const response = await fetch(
        `${BASE_URL}/user/forgot_password/?email=${data.email}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errResp = await response.json();
        throw new Error(errResp.detail);
      }
      toast({
        variant: "success",
        title: "Password reset link sent to your email",
      });
      setLoading(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error?.message : "Password reset failed",
      });
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen bg-gray-100">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <img src="/obt.svg" alt="Logo" className="w-12 h-12 mx-auto mb-4" />
          <CardTitle className="text-center">Forgot Password</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                rules={{
                  required: "Email is required",
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: "Invalid email address",
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Enter your email address"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className={`w-full ${loading ? "opacity-50 cursor-not-allowed" : ""}`}>
                {loading ? "Please wait..." : "Submit"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <div className="text-center mt-4">
        <Link to="/login" className="text-blue-500 hover:underline">
          Back to login page {` > `}
        </Link>
      </div>
    </div>
  );
};

export default ForgotPassword;
