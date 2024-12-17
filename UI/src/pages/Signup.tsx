import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import useAuthStore from "@/store/useAuthStore";
import { useToast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { Link } from 'react-router-dom';

interface SignupForm {
  username: string;
  email: string;
  password: string;
  confirm_password: string; 
}

const SignupPage = () => {
  const { signup, clearError } = useAuthStore();
  const { toast } = useToast()

  const form = useForm<SignupForm>({
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirm_password: '',
    },
  });

  const onSubmit = async (data: SignupForm) => {
  try {
    clearError();
    await signup(data.username, data.email, data.password);
    toast({
      variant: "success",
      title: "Success!",
      description: "Signup successful.",
    })
    window.location.href = '/login';
  } catch (error) {
    console.error('Signup failed', error);
    toast({
      variant: "destructive",
      title: error instanceof Error ? error.message : "Signup failed.",
      action: <ToastAction altText="Try again">Try again</ToastAction>,
    })
  }
};

  return (
    <div className="flex flex-col justify-center items-center h-screen bg-gray-100">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Signup</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                rules={{ 
                  required: 'Username is required',
                  minLength: {
                    value: 3,
                    message: 'Username must be at least 3 characters'
                  }
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input 
                        type="text" 
                        placeholder="Enter your username"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                rules={{ 
                  required: 'Email is required',
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: "Invalid email address"
                  }
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input 
                        type="email" 
                        placeholder="Enter your email"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                rules={{ 
                  required: 'Password is required',
                  minLength: {
                    value: 6,
                    message: 'Password must be at least 6 characters'
                  }
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="Enter your password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirm_password"
                rules={{ 
                  required: 'Please confirm your password',
                  validate: (value) => 
                    value === form.getValues('password') || 'Passwords do not match'
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="Confirm your password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button type="submit" className="w-full">Signup</Button>
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

export default SignupPage;