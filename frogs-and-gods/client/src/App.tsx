import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admin from "./pages/Admin";
import FrogCreationForm from "./pages/FrogCreationForm";
import TestingGround from "./pages/TestingGround";
import MapStudio from "./pages/MapStudio";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Admin} />
      <Route path="/create-frog" component={FrogCreationForm} />
      <Route path="/testing-ground" component={TestingGround} />
      <Route path="/map-studio" component={MapStudio} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "oklch(0.13 0.018 240)",
                border: "1px solid oklch(0.22 0.03 240)",
                color: "oklch(0.92 0.025 80)",
                fontFamily: "'Crimson Text', serif",
              },
            }}
          />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
