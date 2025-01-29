import React, { useState, FormEvent as ReactFormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAuthStore from "@/store/useAuthStore";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const { login } = useAuthStore();

  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!username || !password) {
      toast({
        variant: "destructive",
        title: "Please enter username and password",
      });
      return;
    }
    try {
      await login(username, password);
      toast({
        variant: "success",
        title: "Login successful!",
      });
      navigate("/");
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error?.message : "Login failed",
      });
    }
  };

  const handleSubmit = (e: ReactFormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleLogin();
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen bg-gray-100">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <img src="/obt.svg" alt="Logo" className="w-12 h-12 mx-auto mb-4" />
          {/* <CardTitle>Login</CardTitle> */}
        </CardHeader>
        <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              {/* <label htmlFor="username" className="block mb-2">
                Username
              </label> */}
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              {/* <label htmlFor="password" className="block mb-2">
                Password
              </label> */}
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Login
            </Button>
            <div className="text-center mt-4">
              Don't have an account?{" "}
              <Link to="/signup" className="text-blue-500 hover:underline">
                Sign Up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="text-center mt-4">
        <Link to="/forgot-password" className="text-blue-500 hover:underline">
          Forgot password?{" "}
        </Link>
      </div>
    </div>
  );
};

export default Login;
