import AreaApp from "./components/AreaApp";
import ChatApp from "./components/ChatApp";

function App() {
  const viewType = document.getElementById("root")?.getAttribute("data-view");

  if (viewType === "area") {
    return <AreaApp />;
  }
  return <ChatApp />;
}

export default App;
