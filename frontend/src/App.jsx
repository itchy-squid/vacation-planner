import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { PlannerProvider, usePlannerState } from "./state/PlannerContext";
import { NavGuardProvider } from "./state/NavGuard";
import TripsHome from "./pages/TripsHome";
import NewTrip from "./pages/NewTrip";
import NewPin from "./pages/NewPin";
import TripSettings from "./pages/TripSettings";
import PinBoard from "./pages/PinBoard";
import LassoMap from "./pages/LassoMap";
import DaySchedule from "./pages/DaySchedule";
import CompareSets from "./pages/CompareSets";
import EditVisit from "./pages/EditVisit";
import FinalItinerary from "./pages/FinalItinerary";
import BottomNav from "./components/core/BottomNav";

// Every trip-scoped screen lives under /trips/:tripId/... so a URL always
// carries which trip it's about — paste a link to someone else and it
// opens their browser straight into the same trip (see
// state/PlannerContext.jsx, which reads :tripId off the URL at load time).
// Only Trips Home and the new-trip form are trip-agnostic.
function ScheduleIndexRedirect() {
  const { tripId } = useParams();
  return <Navigate to={`/trips/${tripId}/schedule/1`} replace />;
}

// With no trips in the database there is nothing for a trip-scoped route
// to be about (see PlannerContext's emptyTripView), so only the two
// trip-agnostic screens exist until one is created — everything else,
// including a stale bookmark to /trips/7/board, lands back on Trips Home
// and its empty state. Keeping the guard here rather than in each page
// means no trip-scoped screen ever renders against a null trip.
function AppRoutes() {
  const { trip } = usePlannerState();

  if (!trip) {
    return (
      <Routes>
        <Route path="/" element={<TripsHome />} />
        <Route path="/new-trip" element={<NewTrip />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<TripsHome />} />
      <Route path="/new-trip" element={<NewTrip />} />
      <Route path="/trips/:tripId/board" element={<PinBoard />} />
      <Route path="/trips/:tripId/new-pin" element={<NewPin />} />
      <Route path="/trips/:tripId/trip-settings" element={<TripSettings />} />
      <Route path="/trips/:tripId/map" element={<LassoMap />} />
      <Route path="/trips/:tripId/schedule" element={<ScheduleIndexRedirect />} />
      <Route path="/trips/:tripId/schedule/:day" element={<DaySchedule />} />
      <Route path="/trips/:tripId/contests/:contestId" element={<CompareSets />} />
      <Route path="/trips/:tripId/edit/:pinId" element={<EditVisit />} />
      <Route path="/trips/:tripId/itinerary" element={<FinalItinerary />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <PlannerProvider>
      <BrowserRouter>
        {/* BottomNav sits inside .app-viewport (it's position:fixed, so this
            doesn't move it) purely so it and the routed screen share one
            NavGuardProvider — a screen holding an unsaved draft has to be
            able to intercept a tab-bar tap the same way it intercepts its
            own Cancel. The guard's confirmation sheet renders inside this
            column too, which is what keeps it from spilling past 430px on a
            wide screen. */}
        <div className="app-viewport">
          <NavGuardProvider>
            <AppRoutes />
            <BottomNav />
          </NavGuardProvider>
        </div>
      </BrowserRouter>
    </PlannerProvider>
  );
}
